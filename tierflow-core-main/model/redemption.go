package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/logger"

	"gorm.io/gorm"
)

type Redemption struct {
	Id           int            `json:"id"`
	UserId       int            `json:"user_id"`
	Key          string         `json:"key" gorm:"type:char(32);uniqueIndex"`
	Status       int            `json:"status" gorm:"default:1"`
	Name         string         `json:"name" gorm:"index"`
	Quota        int            `json:"quota" gorm:"default:100"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	RedeemedTime int64          `json:"redeemed_time" gorm:"bigint"`
	Count        int            `json:"count" gorm:"-:all"` // only for api request
	UsedUserId   int            `json:"used_user_id"`
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	ExpiredTime  int64          `json:"expired_time" gorm:"bigint"` // 过期时间，0 表示不过期

	// Type 决定这张码兑换什么：额度码加钱包额度(用 Quota)，订阅码开通套餐(用 PlanId)。
	// 取值见 common.RedemptionType*。
	Type int `json:"type" gorm:"default:0"`
	// PlanId 仅 Type=RedemptionTypeSubscription 时有效，指向 SubscriptionPlan.Id。
	PlanId int `json:"plan_id" gorm:"default:0"`

	// UsedUsername 是 UsedUserId 对应的用户名，列表接口批量回填。
	// 用户可能已被删除，此时为空，前端回退展示 id。
	UsedUsername string `json:"used_username,omitempty" gorm:"-"`
}

// IsSubscriptionType 判断是否订阅码。
func (redemption *Redemption) IsSubscriptionType() bool {
	return redemption.Type == common.RedemptionTypeSubscription
}

func GetAllRedemptions(startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	// 开始事务
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// 获取总数
	err = tx.Model(&Redemption{}).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 获取分页数据
	err = tx.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// 提交事务
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	hydrateRedemptionUsernames(redemptions)
	return redemptions, total, nil
}

// hydrateRedemptionUsernames 批量回填兑换人用户名，避免逐行查询。
// 复用管理端列表通用的 distinctIDs + usernamesByIds（见 model/ticket.go）。
func hydrateRedemptionUsernames(redemptions []*Redemption) {
	if len(redemptions) == 0 {
		return
	}
	ids := distinctIDs(redemptions, func(r *Redemption) int {
		if r == nil {
			return 0
		}
		return r.UsedUserId
	})
	// 未被兑换的码 UsedUserId=0，不必查
	filtered := make([]int, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			filtered = append(filtered, id)
		}
	}
	if len(filtered) == 0 {
		return
	}
	nameById := usernamesByIds(filtered)
	for _, r := range redemptions {
		if r == nil || r.UsedUserId <= 0 {
			continue
		}
		r.UsedUsername = nameById[r.UsedUserId]
	}
}

func SearchRedemptions(keyword string, startIdx int, num int) (redemptions []*Redemption, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// Build query based on keyword type
	query := tx.Model(&Redemption{})

	// Only try to convert to ID if the string represents a valid integer
	if id, err := strconv.Atoi(keyword); err == nil {
		query = query.Where("id = ? OR name LIKE ?", id, keyword+"%")
	} else {
		query = query.Where("name LIKE ?", keyword+"%")
	}

	// Get total count
	err = query.Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated data
	err = query.Order("id desc").Limit(num).Offset(startIdx).Find(&redemptions).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	hydrateRedemptionUsernames(redemptions)
	return redemptions, total, nil
}

func GetRedemptionById(id int) (*Redemption, error) {
	if id == 0 {
		return nil, errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	var err error = nil
	err = DB.First(&redemption, "id = ?", id).Error
	return &redemption, err
}

// RedeemResult 是兑换的产出。Type 决定哪些字段有意义：
// 额度码只填 Quota；订阅码填 PlanTitle/EndTime/SubId。
type RedeemResult struct {
	Type      int    `json:"type"`
	Quota     int    `json:"quota"`
	PlanTitle string `json:"plan_title,omitempty"`
	EndTime   int64  `json:"end_time,omitempty"`
	SubId     int    `json:"sub_id,omitempty"`
	// TokenKey 是开通订阅时自动签发的套餐专用 Key（不含 sk- 前缀）。
	// 与余额购买路径一致地透传，供前端一次性展示——不给的话用户根本不知道
	// 这把 Key 的存在，也就无法使用刚兑换的套餐。
	TokenKey string `json:"token_key,omitempty"`
}

// Redeem 按兑换码类型分派发放：额度码加钱包额度，订阅码开通套餐订阅。
//
// 正确性核心：**所有校验都在 Status→Used 跃迁之前完成**，任何拒绝都让整个事务
// 回滚，兑换码保持未使用状态。否则一次因套餐停用而失败的兑换会白白烧掉用户的码。
//
// 幂等来自 lockForUpdate + status 跃迁：并发的第二次兑换会看到 Status=Used 而被拒。
// 注意 SQLite 下 FOR UPDATE 被静默丢弃(model/lock.go:14-16)，此时依赖 SQLite
// 写事务的库级串行兜底。
func Redeem(key string, userId int) (result *RedeemResult, err error) {
	if key == "" {
		return nil, ErrRedemptionInvalid
	}
	if userId == 0 {
		return nil, errors.New("无效的 user id")
	}
	redemption := &Redemption{}
	result = &RedeemResult{}

	keyCol := "`key`"
	if common.UsingPostgreSQL {
		keyCol = `"key"`
	}
	// 事务提交后才能做的收尾（缓存/日志）所需的信息，在事务内捕获。
	var upgradeGroup string
	var logMsg string
	var quotaCredited int

	common.RandomSleep()
	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where(keyCol+" = ?", key).First(redemption).Error; err != nil {
			return ErrRedemptionInvalid
		}
		// 区分「已被兑换」与「被管理员禁用」：两者都不可用，但用户能采取的行动
		// 完全不同，混为一谈会让用户坚称自己从未兑换过。
		switch redemption.Status {
		case common.RedemptionCodeStatusEnabled:
			// 可用，继续
		case common.RedemptionCodeStatusDisabled:
			return ErrRedemptionDisabled
		default:
			return ErrRedemptionUsed
		}
		if redemption.ExpiredTime != 0 && redemption.ExpiredTime < common.GetTimestamp() {
			return ErrRedemptionExpired
		}

		if redemption.IsSubscriptionType() {
			if err := redeemSubscriptionTx(tx, userId, redemption, result, &upgradeGroup, &logMsg); err != nil {
				return err
			}
		} else {
			// 必须在事务内用 tx 写库以保证回滚一致性，所以走不了 IncreaseUserQuota；
			// 它顺带做的 Redis 缓存递增在事务提交后补（见下方 quotaCredited）。
			res := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota + ?", redemption.Quota))
			if res.Error != nil {
				return res.Error
			}
			// 必须查 RowsAffected：User 带 gorm.DeletedAt，GORM 会给这条 UPDATE 自动追加
			// `deleted_at IS NULL`。账号在鉴权之后被软删除的话，这里影响 0 行且 err == nil，
			// 于是一路走到下面把兑换码置为 Used —— 用户被告知兑换成功、额度零到账、码被永久
			// 烧掉，而 UpdateRedemption 的状态回退守卫又禁止管理员改回 Enabled，无从补救。
			// 返回错误让整个事务回滚，兑换码保持可用，与本函数开头声明的语义一致。
			//
			// 余额购买套餐/升级补差价那两条扣款路径不需要同样的判断：它们在扣款前先
			// lockForUpdate().First(&user)，软删除用户会在那里就 ErrRecordNotFound 回滚。
			if res.RowsAffected == 0 {
				return ErrRedemptionUserMissing
			}
			result.Type = common.RedemptionTypeQuota
			result.Quota = redemption.Quota
			quotaCredited = redemption.Quota
			logMsg = fmt.Sprintf("通过兑换码充值 %s，兑换码ID %d", logger.LogQuota(redemption.Quota), redemption.Id)
		}

		// 只有走到这里才消耗兑换码——上面任何分支返回错误都会整体回滚。
		redemption.RedeemedTime = common.GetTimestamp()
		redemption.Status = common.RedemptionCodeStatusUsed
		redemption.UsedUserId = userId
		return tx.Save(redemption).Error
	})
	if err != nil {
		common.SysError("redemption failed: " + err.Error())
		// 已经是可展示的哨兵就原样上抛，让 controller 分派到具体文案；
		// 其余（数据库故障等）折叠为兜底错误。
		if isRedeemUserFacingError(err) {
			return nil, err
		}
		return nil, ErrRedeemFailed
	}

	// 事务外收尾。
	// 额度缓存必须同步递增：开启 Redis 时 GetUserQuota 读的是缓存，不递增会让
	// 刚充值的用户在缓存 TTL 内持续被判定额度不足（403），账单页也显示旧余额。
	if quotaCredited > 0 {
		if err := cacheIncrUserQuota(userId, int64(quotaCredited)); err != nil {
			common.SysLog("failed to increase user quota cache after redemption: " + err.Error())
		}
	}
	// 改了 users.group 必须清缓存，否则鉴权仍按旧分组走。
	if upgradeGroup != "" {
		_ = UpdateUserGroupCache(userId, upgradeGroup)
	}
	RecordLog(userId, LogTypeTopup, logMsg)
	return result, nil
}

// isRedeemUserFacingError 判断错误是否可以直接展示给用户（而非折叠成兜底文案）。
func isRedeemUserFacingError(err error) bool {
	switch {
	case errors.Is(err, ErrRedemptionInvalid),
		errors.Is(err, ErrRedemptionUsed),
		errors.Is(err, ErrRedemptionDisabled),
		errors.Is(err, ErrRedemptionExpired),
		errors.Is(err, ErrRedemptionPlanMissing),
		errors.Is(err, ErrRedemptionPlanDisabled),
		errors.Is(err, ErrSubscriptionNotUpgradable),
		errors.Is(err, ErrSubscriptionUpgradeOnly),
		errors.Is(err, ErrSubscriptionPurchaseLimitReached):
		return true
	}
	return false
}

// redeemSubscriptionTx 在兑换事务内开通订阅。必须在 tx 内调用。
func redeemSubscriptionTx(
	tx *gorm.DB,
	userId int,
	redemption *Redemption,
	result *RedeemResult,
	upgradeGroup *string,
	logMsg *string,
) error {
	// 必须用 tx 版本取套餐：GetSubscriptionPlanById 会经 DB 池另开连接，
	// SQLite 单连接池下会死锁（见 model/subscription.go:818-819）。
	plan, err := getSubscriptionPlanByIdTx(tx, redemption.PlanId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 套餐被硬删是真实场景（库里已有 plan_id=1 的悬空引用）。
			return ErrRedemptionPlanMissing
		}
		return err
	}
	if !plan.Enabled {
		return ErrRedemptionPlanDisabled
	}

	now := GetDBTimestampTx(tx)
	// 与余额购买同一套守卫：同套餐可叠加续购，已有更高档则引导走升级，
	// 不可降级/平级换购。命中时返回的是哨兵错误，会被原样上抛给用户。
	if err := checkActivePurchaseAllowedTx(tx, userId, plan, now); err != nil {
		return err
	}

	createdSub, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, SubscriptionSourceRedemption)
	if err != nil {
		return err
	}

	// 金额记 0 的订单 + 账单镜像：不写的话这笔订阅在账单页和管理端订单列表里
	// 完全不可见（余额购买曾有过同样的缺失，见 docs/subscription-gap-analysis.md §5）。
	tradeNo := fmt.Sprintf("SUBRDMUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().UnixNano())
	order := &SubscriptionOrder{
		UserId:             userId,
		PlanId:             plan.Id,
		Money:              0,
		TradeNo:            tradeNo,
		PaymentMethod:      PaymentMethodRedemption,
		PaymentProvider:    PaymentProviderRedemption,
		Status:             common.TopUpStatusSuccess,
		OrderType:          SubscriptionOrderTypeNew,
		UserSubscriptionId: createdSub.Id,
		CreateTime:         now,
		CompleteTime:       now,
		ProviderPayload:    fmt.Sprintf("redemption_id=%d", redemption.Id),
	}
	if err := tx.Create(order).Error; err != nil {
		return err
	}
	if err := upsertSubscriptionTopUpTx(tx, order, common.TopUpStatusSuccess, false); err != nil {
		return err
	}

	result.Type = common.RedemptionTypeSubscription
	result.TokenKey = createdSub.IssuedTokenKey
	result.PlanTitle = plan.Title
	result.EndTime = createdSub.EndTime
	result.SubId = createdSub.Id
	*upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
	*logMsg = fmt.Sprintf("通过兑换码开通订阅，套餐: %s，兑换码ID %d", plan.Title, redemption.Id)
	return nil
}

func (redemption *Redemption) Insert() error {
	var err error
	err = DB.Create(redemption).Error
	return err
}

func (redemption *Redemption) SelectUpdate() error {
	// This can update zero values
	return DB.Model(redemption).Select("redeemed_time", "status").Updates(redemption).Error
}

// Update Make sure your token's fields is completed, because this will update non-zero values
// 注意：新增字段必须同步加进下面的 Select 白名单，否则更新会被静默丢弃。
func (redemption *Redemption) Update() error {
	var err error
	err = DB.Model(redemption).Select("name", "status", "quota", "redeemed_time", "expired_time", "type", "plan_id").Updates(redemption).Error
	return err
}

func (redemption *Redemption) Delete() error {
	var err error
	err = DB.Delete(redemption).Error
	return err
}

func DeleteRedemptionById(id int) (err error) {
	if id == 0 {
		return errors.New("id 为空！")
	}
	redemption := Redemption{Id: id}
	err = DB.Where(redemption).First(&redemption).Error
	if err != nil {
		return err
	}
	return redemption.Delete()
}

func DeleteInvalidRedemptions() (int64, error) {
	now := common.GetTimestamp()
	result := DB.Where("status IN ? OR (status = ? AND expired_time != 0 AND expired_time < ?)", []int{common.RedemptionCodeStatusUsed, common.RedemptionCodeStatusDisabled}, common.RedemptionCodeStatusEnabled, now).Delete(&Redemption{})
	return result.RowsAffected, result.Error
}
