package model

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"

	"gorm.io/gorm"
)

// ModelGroup 模型组：把一组异构的上游模型成员打包成一个可复用的候选集合。
//
// 与 RoutingProfile 的关系：模型组仅作为 RoutingProfile 各档位(tier)的候选来源使用，
// 不允许被客户端直接点名请求。每个成员是一个显式的 (channel_id, upstream_model_name) 组合——
// 同一逻辑模型在不同渠道上可能有不同的上游名，因此成员是异构的。
// 成员携带可选的 Priority，供后续(G2)故障转移排序使用。
type ModelGroup struct {
	Id          int    `json:"id" gorm:"primaryKey"`
	Name        string `json:"name" gorm:"type:varchar(128);uniqueIndex"`
	Description string `json:"description" gorm:"type:text"`
	Enabled     bool   `json:"enabled" gorm:"default:true"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint"`
	// Members 不落在 model_groups 表(gorm:"-")，单独存于 model_group_members 表，
	// 读写时手工装配，便于按 (channel_id, model_name) 查询与后续路由解析。
	Members []ModelGroupMember `json:"members" gorm:"-"`
}

// ModelGroupMember 模型组成员：一个显式的 (channel_id, upstream_model_name) 组合。
type ModelGroupMember struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	GroupId   int    `json:"group_id" gorm:"index"`
	ChannelId int    `json:"channel_id"`
	ModelName string `json:"model_name" gorm:"type:varchar(255)"`
	// Priority 可选：故障转移排序用(数值越大越优先，语义在 G2 落地)。指针以区分「未设置」与 0。
	Priority *int64 `json:"priority" gorm:"bigint"`
}

// ---------- 成员校验 ----------

// validateModelGroupMembers 校验每个成员 (channel_id, model_name) 在 abilities 表中
// 存在一条已启用的记录(即该渠道确实提供并启用了该上游模型)。任一非法即返回错误并指明成员。
func validateModelGroupMembers(members []ModelGroupMember) error {
	for _, m := range members {
		name := strings.TrimSpace(m.ModelName)
		if name == "" {
			return fmt.Errorf("成员模型名不能为空 (channel_id=%d)", m.ChannelId)
		}
		var count int64
		err := DB.Model(&Ability{}).
			Where("model = ? and channel_id = ? and enabled = ?", name, m.ChannelId, true).
			Count(&count).Error
		if err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("无效成员：渠道 %d 上不存在已启用的模型 %q", m.ChannelId, name)
		}
	}
	return nil
}

// ---------- 内存缓存（groupId -> members，仅含启用组） ----------

var (
	modelGroupCacheLock   sync.RWMutex
	modelGroupMembersById map[int][]ModelGroupMember
	modelGroupNameById    map[int]string
	modelGroupsLoaded     bool
)

// reloadModelGroupCache 从 DB 重建 groupId->members 缓存(仅收录启用组的成员)。
func reloadModelGroupCache() error {
	var groups []*ModelGroup
	if err := DB.Where("enabled = ?", true).Find(&groups).Error; err != nil {
		return err
	}
	enabledIds := make(map[int]bool, len(groups))
	nameById := make(map[int]string, len(groups))
	for _, g := range groups {
		enabledIds[g.Id] = true
		nameById[g.Id] = g.Name
	}
	var members []ModelGroupMember
	if err := DB.Find(&members).Error; err != nil {
		return err
	}
	byGroup := make(map[int][]ModelGroupMember)
	for _, m := range members {
		if !enabledIds[m.GroupId] {
			continue
		}
		byGroup[m.GroupId] = append(byGroup[m.GroupId], m)
	}
	modelGroupCacheLock.Lock()
	modelGroupMembersById = byGroup
	modelGroupNameById = nameById
	modelGroupsLoaded = true
	modelGroupCacheLock.Unlock()
	return nil
}

// InitModelGroupCache 启动时预热缓存（可选，未调用时首个请求会惰性加载）。
func InitModelGroupCache() error {
	return reloadModelGroupCache()
}

// InvalidateModelGroupCache 写操作后刷新缓存。
func InvalidateModelGroupCache() {
	if err := reloadModelGroupCache(); err != nil {
		common.SysError("failed to reload model group cache: " + err.Error())
	}
}

// GetModelGroupMembers 返回指定启用组的成员副本(请求时解析用)。线程安全 + 惰性加载。
func GetModelGroupMembers(groupId int) []ModelGroupMember {
	modelGroupCacheLock.RLock()
	loaded := modelGroupsLoaded
	m := modelGroupMembersById
	modelGroupCacheLock.RUnlock()

	if !loaded {
		if err := reloadModelGroupCache(); err != nil {
			return nil
		}
		modelGroupCacheLock.RLock()
		m = modelGroupMembersById
		modelGroupCacheLock.RUnlock()
	}
	if m == nil {
		return nil
	}
	src := m[groupId]
	out := make([]ModelGroupMember, len(src))
	copy(out, src)
	return out
}

// GetModelGroupNameById 返回启用组的名称(路由埋点用，记录请求命中的组名快照)。
// 线程安全 + 惰性加载；组不存在或被禁用时返回空串。
func GetModelGroupNameById(groupId int) string {
	modelGroupCacheLock.RLock()
	loaded := modelGroupsLoaded
	names := modelGroupNameById
	modelGroupCacheLock.RUnlock()

	if !loaded {
		if err := reloadModelGroupCache(); err != nil {
			return ""
		}
		modelGroupCacheLock.RLock()
		names = modelGroupNameById
		modelGroupCacheLock.RUnlock()
	}
	return names[groupId]
}

// ---------- CRUD ----------

// GetAllModelGroups 列出全部模型组(含禁用)，并装配各自成员。
func GetAllModelGroups() ([]*ModelGroup, error) {
	var groups []*ModelGroup
	if err := DB.Order("id desc").Find(&groups).Error; err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return groups, nil
	}
	var members []ModelGroupMember
	if err := DB.Find(&members).Error; err != nil {
		return nil, err
	}
	byGroup := make(map[int][]ModelGroupMember)
	for _, m := range members {
		byGroup[m.GroupId] = append(byGroup[m.GroupId], m)
	}
	for _, g := range groups {
		if ms := byGroup[g.Id]; ms != nil {
			g.Members = ms
		} else {
			g.Members = []ModelGroupMember{}
		}
	}
	return groups, nil
}

// GetModelGroupById 按 id 取单个模型组并装配成员。
func GetModelGroupById(id int) (*ModelGroup, error) {
	if id == 0 {
		return nil, errors.New("id 不能为空")
	}
	g := &ModelGroup{}
	if err := DB.First(g, "id = ?", id).Error; err != nil {
		return nil, err
	}
	var members []ModelGroupMember
	if err := DB.Where("group_id = ?", id).Find(&members).Error; err != nil {
		return nil, err
	}
	g.Members = members
	return g, nil
}

// AddModelGroup 新建模型组及其成员(整体事务)。成员校验不通过则整体失败。
func AddModelGroup(g *ModelGroup, members []ModelGroupMember) error {
	if err := validateModelGroupMembers(members); err != nil {
		return err
	}
	g.CreatedTime = common.GetTimestamp()
	g.UpdatedTime = g.CreatedTime
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(g).Error; err != nil {
			return err
		}
		for i := range members {
			members[i].Id = 0
			members[i].GroupId = g.Id
		}
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		g.Members = members
		InvalidateModelGroupCache()
	}
	return err
}

// UpdateModelGroup 更新模型组(全量字段)并整体替换其成员(整体事务)。
func UpdateModelGroup(g *ModelGroup, members []ModelGroupMember) error {
	if g.Id == 0 {
		return errors.New("id 不能为空")
	}
	if err := validateModelGroupMembers(members); err != nil {
		return err
	}
	g.UpdatedTime = common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Save 写全字段，保证 Enabled=false / 清空描述等零值能落库
		if err := tx.Save(g).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id = ?", g.Id).Delete(&ModelGroupMember{}).Error; err != nil {
			return err
		}
		for i := range members {
			members[i].Id = 0
			members[i].GroupId = g.Id
		}
		if len(members) > 0 {
			if err := tx.Create(&members).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		g.Members = members
		InvalidateModelGroupCache()
	}
	return err
}

// DeleteModelGroupById 删除模型组及其全部成员(整体事务)。
func DeleteModelGroupById(id int) error {
	if id == 0 {
		return errors.New("id 不能为空")
	}
	// 引用检查：被路由方案的档位(或多模态模型)引用的组不允许删除，否则 tier 里
	// 留下悬空 mg:<id>，路由时静默透传、看板组维度出现空洞。
	ref := FormatModelGroupRef(id)
	var referers []string
	if err := DB.Model(&RoutingProfile{}).
		Where("tier1_model = ? OR tier2_model = ? OR tier3_model = ? OR tier4_model = ? OR tier5_model = ? OR multimodal_model = ?",
			ref, ref, ref, ref, ref, ref).
		Pluck("slug", &referers).Error; err != nil {
		return err
	}
	if len(referers) > 0 {
		return fmt.Errorf("该模型组正被路由方案 %s 引用，请先在路由配置中解除引用", strings.Join(referers, "、"))
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&ModelGroup{Id: id}).Error; err != nil {
			return err
		}
		if err := tx.Where("group_id = ?", id).Delete(&ModelGroupMember{}).Error; err != nil {
			return err
		}
		return nil
	})
	if err == nil {
		InvalidateModelGroupCache()
	}
	return err
}

// ---------- tier → 模型组 引用解析（G2） ----------

// ModelGroupRefPrefix 是 RoutingProfile 各档位(tier)字段里"引用模型组"的前缀。
// 档位值形如 "mg:12" 表示引用 id=12 的模型组；无此前缀则视为传统的具体模型名(向后兼容)。
const ModelGroupRefPrefix = "mg:"

// IsModelGroupRef 判断档位值是否为模型组引用。
func IsModelGroupRef(tierValue string) bool {
	return strings.HasPrefix(strings.TrimSpace(tierValue), ModelGroupRefPrefix)
}

// ParseModelGroupRef 解析 "mg:<id>" 为组 id；非法/非引用返回 (0,false)。
func ParseModelGroupRef(tierValue string) (int, bool) {
	s := strings.TrimSpace(tierValue)
	if !strings.HasPrefix(s, ModelGroupRefPrefix) {
		return 0, false
	}
	id, err := strconv.Atoi(strings.TrimSpace(s[len(ModelGroupRefPrefix):]))
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// FormatModelGroupRef 构造档位引用字符串(前端/迁移用)。
func FormatModelGroupRef(groupId int) string {
	return ModelGroupRefPrefix + strconv.Itoa(groupId)
}

// memberPriority 返回成员排序用优先级(nil 视为 0)。
func memberPriority(m ModelGroupMember) int64 {
	if m.Priority == nil {
		return 0
	}
	return *m.Priority
}

// GetOrderedModelGroupMembers 返回启用组的成员，按 Priority 降序稳定排序(优先级相同保持
// 原始顺序)，供请求期故障转移按序尝试。空组返回 nil。
func GetOrderedModelGroupMembers(groupId int) []ModelGroupMember {
	members := GetModelGroupMembers(groupId)
	if len(members) == 0 {
		return nil
	}
	sort.SliceStable(members, func(i, j int) bool {
		return memberPriority(members[i]) > memberPriority(members[j])
	})
	return members
}

// AllowedChannelIdsFromMembers 从成员列表提取渠道ID白名单(map[int]bool)，供渠道选择约束用。
func AllowedChannelIdsFromMembers(members []ModelGroupMember) map[int]bool {
	if len(members) == 0 {
		return nil
	}
	allow := make(map[int]bool, len(members))
	for _, m := range members {
		allow[m.ChannelId] = true
	}
	return allow
}

// PickModelGroupMember 从有序成员列表里挑出下一个可用成员用于本次(重试)尝试:
// 跳过 exclude(本请求已试过的渠道)与熔断冷却中的渠道;成员已按优先级降序。
// 渐进放宽:①未试过且熔断可用 ②未试过 ③整表兜底(避免因全部冷却而硬失败)。
// 返回命中成员与其在列表中的下标;空列表返回 (member{}, -1)。
func PickModelGroupMember(members []ModelGroupMember, exclude map[int]bool) (ModelGroupMember, int) {
	if len(members) == 0 {
		return ModelGroupMember{}, -1
	}
	excluded := func(id int) bool { return exclude != nil && exclude[id] }
	// ① 未试过且熔断可用
	for i, m := range members {
		if !excluded(m.ChannelId) && routehealth.IsChannelAvailable(m.ChannelId) {
			return m, i
		}
	}
	// ② 未试过(冷却中也用,好过重试刚失败的)
	for i, m := range members {
		if !excluded(m.ChannelId) {
			return m, i
		}
	}
	// ③ 兜底:全部试过,返回第一个
	return members[0], 0
}
