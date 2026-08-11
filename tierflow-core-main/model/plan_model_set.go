package model

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"

	"gorm.io/gorm"
)

// PlanModelSet 套餐模型组:把若干**模型组**(ModelGroup,同一逻辑模型的多上游花名册)
// 打包成套餐额度桶的授权集合。
//
// 与 ModelGroup 的分层(docs/subscription-gap-analysis.md §7.4):
//
//	套餐 Plan ─ 高级桶 → PlanModelSet(premium)─┬─ ModelGroup A(GPT5.5 × N 上游)
//	          └ 基础桶 → PlanModelSet(basic)   └─ ModelGroup B(GLM5.2 × N 上游)…
//
// 计费/路由用 ResolveModelBucket 判断「本次请求命中的模型属于哪个桶」。
type PlanModelSet struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"type:varchar(128);uniqueIndex"`
	Description string `json:"description" gorm:"type:text"`
	Enabled     bool   `json:"enabled" gorm:"default:true"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint"`
	// Members 不落在 plan_model_sets 表(gorm:"-"),单独存于 plan_model_set_members,
	// 读写时手工装配(与 ModelGroup.Members 同模式)。
	Members []PlanModelSetMember `json:"members" gorm:"-"`
}

// PlanModelSetMember 套餐模型组成员:引用一个模型组。
type PlanModelSetMember struct {
	Id           int `json:"id" gorm:"primaryKey"`
	SetId        int `json:"set_id" gorm:"index"`
	ModelGroupId int `json:"model_group_id" gorm:"index"`
}

// ---------- 成员校验 ----------

// validatePlanModelSetMembers 校验成员引用的模型组存在,且组内不重复。
func validatePlanModelSetMembers(members []PlanModelSetMember) error {
	seen := make(map[int]bool, len(members))
	for _, m := range members {
		if m.ModelGroupId <= 0 {
			return errors.New("成员模型组 id 非法")
		}
		if seen[m.ModelGroupId] {
			return fmt.Errorf("模型组 %d 重复添加", m.ModelGroupId)
		}
		seen[m.ModelGroupId] = true
		var count int64
		if err := DB.Model(&ModelGroup{}).Where("id = ?", m.ModelGroupId).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("模型组 %d 不存在", m.ModelGroupId)
		}
	}
	return nil
}

// ---------- 内存缓存(setId -> 成员模型组 id 集合,仅含启用 set) ----------

var (
	planModelSetCacheLock sync.RWMutex
	planModelSetGroupIds  map[int]map[int]bool
	planModelSetsLoaded   bool

	// 惰性加载的串行化 + 失败退避。加载失败时不能把 loaded 置真(否则会把
	// "空集合" 永久缓存,所有模型静默退化成 premium 桶),但也不能每个请求都
	// 重试——DB 抖动时,每次中继请求都会打两条全表扫描,把已经吃力的库压垮。
	planModelSetLoadMu    sync.Mutex
	planModelSetNextRetry time.Time
)

// planModelSetRetryInterval 惰性加载失败后的重试间隔。
const planModelSetRetryInterval = 10 * time.Second

func reloadPlanModelSetCache() error {
	var sets []*PlanModelSet
	if err := DB.Where("enabled = ?", true).Find(&sets).Error; err != nil {
		return err
	}
	enabled := make(map[int]bool, len(sets))
	for _, s := range sets {
		enabled[s.Id] = true
	}
	var members []PlanModelSetMember
	if err := DB.Find(&members).Error; err != nil {
		return err
	}
	bySet := make(map[int]map[int]bool)
	for _, m := range members {
		if !enabled[m.SetId] {
			continue
		}
		if bySet[m.SetId] == nil {
			bySet[m.SetId] = make(map[int]bool)
		}
		bySet[m.SetId][m.ModelGroupId] = true
	}
	planModelSetCacheLock.Lock()
	planModelSetGroupIds = bySet
	planModelSetsLoaded = true
	planModelSetCacheLock.Unlock()
	return nil
}

// InitPlanModelSetCache 启动时预热缓存。正常部署下惰性加载路径不该被走到。
func InitPlanModelSetCache() error {
	return reloadPlanModelSetCache()
}

// InvalidatePlanModelSetCache 写操作后刷新缓存。
func InvalidatePlanModelSetCache() {
	if err := reloadPlanModelSetCache(); err != nil {
		common.SysError("failed to reload plan model set cache: " + err.Error())
	}
}

// ensurePlanModelSetCache 保证缓存已加载。并发调用只有一个真正打 DB,
// 加载失败则在 planModelSetRetryInterval 内不再重试,避免拖垮已经异常的库。
func ensurePlanModelSetCache() {
	planModelSetCacheLock.RLock()
	loaded := planModelSetsLoaded
	planModelSetCacheLock.RUnlock()
	if loaded {
		return
	}

	planModelSetLoadMu.Lock()
	defer planModelSetLoadMu.Unlock()

	// 等锁期间可能已被别的 goroutine 加载好。
	planModelSetCacheLock.RLock()
	loaded = planModelSetsLoaded
	planModelSetCacheLock.RUnlock()
	if loaded {
		return
	}
	if now := time.Now(); now.Before(planModelSetNextRetry) {
		return
	} else if err := reloadPlanModelSetCache(); err != nil {
		planModelSetNextRetry = now.Add(planModelSetRetryInterval)
		common.SysError("failed to load plan model set cache: " + err.Error())
	}
}

// planSetContains 判断 set 是否直接包含某模型组 id。不复制 map。
func planSetContains(setId, modelGroupId int) bool {
	ensurePlanModelSetCache()
	planModelSetCacheLock.RLock()
	defer planModelSetCacheLock.RUnlock()
	return planModelSetGroupIds[setId][modelGroupId]
}

// planSetGroupIdsSnapshot 取 set 的成员模型组 id 列表(切片,仅供本包内遍历)。
// 返回切片而非 map:调用方只需遍历,省掉一次 map 分配与哈希开销。
func planSetGroupIdsSnapshot(setId int) []int {
	ensurePlanModelSetCache()
	planModelSetCacheLock.RLock()
	defer planModelSetCacheLock.RUnlock()
	src := planModelSetGroupIds[setId]
	if len(src) == 0 {
		return nil
	}
	out := make([]int, 0, len(src))
	for gid := range src {
		out = append(out, gid)
	}
	return out
}

// planSetMinGroupId 取 set 内最小的模型组 id;set 为空返回 0。不分配。
func planSetMinGroupId(setId int) int {
	ensurePlanModelSetCache()
	planModelSetCacheLock.RLock()
	defer planModelSetCacheLock.RUnlock()
	best := 0
	for gid := range planModelSetGroupIds[setId] {
		if best == 0 || gid < best {
			best = gid
		}
	}
	return best
}

// ---------- 桶判定 ----------

// setContainsModel 判断 set 是否覆盖 (modelGroupId | modelName)。
// modelGroupId > 0 时按组 id 精确匹配;否则按 modelName 反查其所属的所有模型组再匹配。
func setContainsModel(setId int, modelGroupId int, modelName string) bool {
	if setId <= 0 {
		return false
	}
	if modelGroupId > 0 {
		return planSetContains(setId, modelGroupId)
	}
	name := strings.TrimSpace(modelName)
	if name == "" {
		return false
	}
	// 反查:遍历 set 内各模型组的成员,看是否含此模型名。
	// 组数与成员数都是小量(个位数~几十),线性扫描即可;成员来自 ModelGroup 内存缓存。
	for _, gid := range planSetGroupIdsSnapshot(setId) {
		for _, m := range GetModelGroupMembers(gid) {
			if m.ModelName == name {
				return true
			}
		}
	}
	return false
}

// ResolveModelBucket 判定模型属于套餐的哪个桶。
// 判定顺序:basic set 命中 → basic;premium set 命中 → premium;
// 都未命中(或套餐未配置 set)→ premium(保守:按贵的桶扣,避免漏计费)。
// 先查 basic 是因为其成员集合小(早期只有一个基础模型),且误判为 premium
// 只是多扣钱桶,误判为 basic 会漏钱。
func ResolveModelBucket(plan *SubscriptionPlan, modelGroupId int, modelName string) SubscriptionBucket {
	if plan == nil {
		return BucketPremium
	}
	if setContainsModel(plan.BasicSetId, modelGroupId, modelName) {
		return BucketBasic
	}
	return BucketPremium
}

// PickSetModelGroup 从启用 set 中选一个模型组 id 供路由改写(取最小 id,确定性)。
// set 未配置/为空返回 (0,false)。
func PickSetModelGroup(setId int) (int, bool) {
	best := planSetMinGroupId(setId)
	return best, best > 0
}

// ---------- CRUD ----------

// GetAllPlanModelSets 列出全部套餐模型组(含禁用),装配成员。
func GetAllPlanModelSets() ([]*PlanModelSet, error) {
	var sets []*PlanModelSet
	if err := DB.Order("id desc").Find(&sets).Error; err != nil {
		return nil, err
	}
	if len(sets) == 0 {
		return sets, nil
	}
	var members []PlanModelSetMember
	if err := DB.Find(&members).Error; err != nil {
		return nil, err
	}
	bySet := make(map[int][]PlanModelSetMember)
	for _, m := range members {
		bySet[m.SetId] = append(bySet[m.SetId], m)
	}
	for _, s := range sets {
		if ms := bySet[s.Id]; ms != nil {
			s.Members = ms
		} else {
			s.Members = []PlanModelSetMember{}
		}
	}
	return sets, nil
}

// GetPlanModelSetById 按 id 取单个套餐模型组并装配成员。
func GetPlanModelSetById(id int) (*PlanModelSet, error) {
	if id == 0 {
		return nil, errors.New("id 不能为空")
	}
	s := &PlanModelSet{}
	if err := DB.First(s, "id = ?", id).Error; err != nil {
		return nil, err
	}
	var members []PlanModelSetMember
	if err := DB.Where("set_id = ?", id).Find(&members).Error; err != nil {
		return nil, err
	}
	s.Members = members
	return s, nil
}

// AddPlanModelSet 新建套餐模型组及其成员(整体事务)。
func AddPlanModelSet(s *PlanModelSet, members []PlanModelSetMember) error {
	if err := validatePlanModelSetMembers(members); err != nil {
		return err
	}
	s.CreatedTime = common.GetTimestamp()
	s.UpdatedTime = s.CreatedTime
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(s).Error; err != nil {
			return err
		}
		for i := range members {
			members[i].Id = 0
			members[i].SetId = s.Id
		}
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		s.Members = members
		InvalidatePlanModelSetCache()
	}
	return err
}

// UpdatePlanModelSet 更新套餐模型组(全量字段)并整体替换成员(整体事务)。
func UpdatePlanModelSet(s *PlanModelSet, members []PlanModelSetMember) error {
	if s.Id == 0 {
		return errors.New("id 不能为空")
	}
	if err := validatePlanModelSetMembers(members); err != nil {
		return err
	}
	s.UpdatedTime = common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Save(s).Error; err != nil {
			return err
		}
		if err := tx.Where("set_id = ?", s.Id).Delete(&PlanModelSetMember{}).Error; err != nil {
			return err
		}
		for i := range members {
			members[i].Id = 0
			members[i].SetId = s.Id
		}
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		s.Members = members
		InvalidatePlanModelSetCache()
	}
	return err
}

// DeletePlanModelSetById 删除套餐模型组及其成员。被套餐引用时拒绝删除,
// 否则套餐桶会留下悬空 set id,桶判定静默退化为 premium。
func DeletePlanModelSetById(id int) error {
	if id == 0 {
		return errors.New("id 不能为空")
	}
	var referers []string
	if err := DB.Model(&SubscriptionPlan{}).
		Where("premium_set_id = ? OR basic_set_id = ?", id, id).
		Pluck("title", &referers).Error; err != nil {
		return err
	}
	if len(referers) > 0 {
		return fmt.Errorf("该套餐模型组正被套餐 %s 引用,请先解除引用", strings.Join(referers, "、"))
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&PlanModelSet{Id: id}).Error; err != nil {
			return err
		}
		if err := tx.Where("set_id = ?", id).Delete(&PlanModelSetMember{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err == nil {
		InvalidatePlanModelSetCache()
	}
	return err
}

// planModelSetExists 供套餐校验:set 是否存在(不要求启用,便于先配后启)。
func planModelSetExists(id int) (bool, error) {
	if id <= 0 {
		return false, nil
	}
	var count int64
	if err := DB.Model(&PlanModelSet{}).Where("id = ?", id).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// ValidatePlanModelSetId 校验套餐引用的 set id(0 = 未配置,合法)。
func ValidatePlanModelSetId(id int, label string) error {
	if id < 0 {
		return fmt.Errorf("%s id 非法", label)
	}
	if id == 0 {
		return nil
	}
	ok, err := planModelSetExists(id)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("%s %d 不存在", label, id)
	}
	return nil
}
