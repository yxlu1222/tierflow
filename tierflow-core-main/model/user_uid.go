/*
Copyright (C) 2023-2026 TierFlow
*/
package model

import (
	"crypto/rand"
	"errors"
	"math/big"
	"strconv"
	"sync"

	"gorm.io/gorm"
)

// 对外用户标识 uid 的取值区间:[10^11, 10^12)。
// 加上 uidMin 的偏移保证首位非零,因此 strconv 输出恒为 12 位。
const (
	uidMin  int64 = 100000000000 // 10^11
	uidSpan int64 = 900000000000 // 9×10^11,可用空间大小
	uidLen        = 12

	// 预检分配的最大尝试次数。9×10^11 的空间下单次命中已存在值的概率约为
	// 用户数 / 9e11,8 次全部撞上在任何可预见规模下都不可能发生。
	uidMaxAttempts = 8
)

// GenerateUid 生成一个 12 位纯数字的对外用户标识。
//
// 必须使用 crypto/rand:uid 的全部意义在于不可预测(否则又变回可枚举的自增值)。
// common.GetRandomString 与 common.GetRandomInt 走的是 math/rand,不可用于此处。
func GenerateUid() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(uidSpan))
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(n.Int64()+uidMin, 10), nil
}

// IsValidUidFormat 校验字符串是否为合法的 uid 形态(12 位纯数字、首位非零)。
// 鉴权中间件用它替代原先的 strconv.Atoi 格式校验。
func IsValidUidFormat(s string) bool {
	if len(s) != uidLen || s[0] == '0' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// allocateUid 预检式分配:先 SELECT 查重,确认空闲后才返回候选值。
//
// 为什么是预检而不是「插入失败后重试」:InsertWithTx 运行在调用方的事务里,
// PostgreSQL 下一旦 INSERT 撞上唯一约束,整个事务即进入 aborted 状态,
// 同一事务内的任何后续语句都会失败,重试无从谈起。而返回 0 行的 SELECT
// 是正常语句、不会污染事务,因此预检可以安全地放在事务内循环。
//
// 查重必须带 Unscoped:软删用户的行仍然留在表中、仍然占用唯一索引。
//
// 预检与实际 INSERT 之间存在竞态窗口,最终由唯一索引兜底。万级用户下该窗口
// 命中概率约 10^-8 量级,不值得为此引入 savepoint 或咨询锁。
func allocateUid(tx *gorm.DB) (string, error) {
	for i := 0; i < uidMaxAttempts; i++ {
		candidate, err := GenerateUid()
		if err != nil {
			return "", err
		}
		var count int64
		if err := tx.Unscoped().Model(&User{}).Where("uid = ?", candidate).Count(&count).Error; err != nil {
			return "", err
		}
		if count == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("failed to allocate a unique uid")
}

// BeforeCreate 在任何创建路径上分配 uid。
//
// 用 GORM hook 而非逐个修改调用点:当前有 Insert(无事务)与 InsertWithTx
// (在外部事务内)两条路径,将来可能更多,hook 是唯一不会漏的位置。
// 已显式指定 uid 时不覆盖,以保证幂等。
func (user *User) BeforeCreate(tx *gorm.DB) error {
	if user.Uid != nil && *user.Uid != "" {
		return nil
	}
	uid, err := allocateUid(tx)
	if err != nil {
		return err
	}
	user.Uid = &uid
	return nil
}

// PublicUid 返回对外展示用的 uid;未分配时返回空串。
// 调用方应把空串视为「不可用」并拒绝放行,不要退回内部 id。
func (user *User) PublicUid() string {
	if user == nil || user.Uid == nil {
		return ""
	}
	return *user.Uid
}

// EnsureUserUid 为 uid 仍为空的用户就地补分配一个并落库。
//
// 迁移期的回填只在 master 节点执行(见 InitDB),因此一个 worker 节点完全
// 可能在 master 尚未回填完成时就开始服务登录。若放任 uid 为空,用户会
// 「登录返回 200、之后每个请求都 401」且没有任何自愈路径 —— 客户端拿不到
// uid 就发不出 TF-User 头,服务端的空 uid 守卫也会拒绝。
//
// 写入用与回填相同的条件式 UPDATE,因此与并发的回填/其它节点是安全的:
// 谁先写入谁生效,随后回读取得权威值。
func EnsureUserUid(user *User) error {
	if user == nil {
		return errors.New("user is nil")
	}
	if user.Uid != nil && *user.Uid != "" {
		return nil
	}
	uid, err := allocateUid(DB)
	if err != nil {
		return err
	}
	if err := DB.Model(&User{}).
		Where("id = ? AND (uid IS NULL OR uid = ?)", user.Id, "").
		Update("uid", uid).Error; err != nil {
		return err
	}
	// 可能被并发写入抢先,故回读而非直接采用本地生成的值。
	var fresh User
	if err := DB.Select("uid").Where("id = ?", user.Id).First(&fresh).Error; err != nil {
		return err
	}
	if fresh.Uid == nil || *fresh.Uid == "" {
		return errors.New("failed to assign uid")
	}
	user.Uid = fresh.Uid
	return nil
}

// GetUserIdByUid 由对外 uid 反查内部自增 id。
func GetUserIdByUid(uid string) (int, error) {
	if !IsValidUidFormat(uid) {
		return 0, errors.New("无效的用户标识")
	}
	var user User
	err := DB.Select("id").Where("uid = ?", uid).First(&user).Error
	return user.Id, err
}

// uidByIdCache 缓存 id → uid。uid 一经分配即不可变，所以永不过期、无需失效逻辑。
// 只缓存查到的非空值：尚未回填 uid 的用户下次仍会重查，等 master 回填完就能拿到。
var uidByIdCache sync.Map

// GetUidById 由内部自增 id 取对外 uid；取不到返回空串。
//
// 供落盘/导出这类**对外数据**使用：内部自增 id 不应出现在数据资产里
// (见 User.Uid 注释)。与 PublicUid 一致，空串意味着「不可用」，
// 调用方应当丢弃该条记录，**不要退回内部 id**。
func GetUidById(id int) string {
	if id <= 0 {
		return ""
	}
	if v, ok := uidByIdCache.Load(id); ok {
		return v.(string)
	}
	var user User
	if err := DB.Select("uid").Where("id = ?", id).First(&user).Error; err != nil {
		return ""
	}
	uid := user.PublicUid()
	if uid == "" {
		return ""
	}
	uidByIdCache.Store(id, uid)
	return uid
}
