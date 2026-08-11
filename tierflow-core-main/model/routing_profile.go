package model

import (
	"errors"
	"strconv"
	"strings"
	"sync"

	"github.com/Zer0Echo/tierflow-core/common"
)

// RoutingProfile 智能路由配置（TierFlow auto 路由）。
//
// 一个 profile 把若干别名（如 "auto"）映射到一套"难度打分 → 分档 → 具体模型"的路由策略：
// 请求命中别名后，AutoRoute 中间件调用 tierflow-infer 对会话难度打分（0-10），
// 按 ScoreBands 把分数映射到 tier(1-5)，再取对应 TierNModel 作为最终模型。
type RoutingProfile struct {
	Id   int    `json:"id" gorm:"primaryKey"`
	Slug string `json:"slug" gorm:"type:varchar(64);uniqueIndex"`
	Name string `json:"name" gorm:"type:varchar(128)"`
	// Aliases 逗号分隔的用户请求模型名，命中即走本 profile（如 "auto,tierflow-auto"）
	Aliases string `json:"aliases" gorm:"type:text"`
	// ScoreBands 分数档位映射，格式 "0-3:5,3-5:4,5-7:3,7-9:2,9-10:1"（区间:tier）
	ScoreBands string `json:"score_bands" gorm:"type:varchar(512)"`
	// TierNModel tier N（1=最高难度，5=最低难度）对应的具体模型名
	Tier1Model string `json:"tier_1_model" gorm:"type:varchar(120)"`
	Tier2Model string `json:"tier_2_model" gorm:"type:varchar(120)"`
	Tier3Model string `json:"tier_3_model" gorm:"type:varchar(120)"`
	Tier4Model string `json:"tier_4_model" gorm:"type:varchar(120)"`
	Tier5Model string `json:"tier_5_model" gorm:"type:varchar(120)"`
	// MultimodalModel 当请求含多模态内容（图片/音频/文件/视频）时，跳过打分直接路由到此模型。
	// 留空=不启用（多模态请求仍按难度打分，可能落到不支持多模态的模型而被上游拒）。
	MultimodalModel string `json:"multimodal_model" gorm:"type:varchar(120)"`
	// Group 可选：限定分组（保留字段，P1 暂不强制使用）。列名用 group_name 避开保留字。
	Group       string `json:"group" gorm:"column:group_name;type:varchar(64)"`
	Enabled     bool   `json:"enabled" gorm:"default:true"`
	Description string `json:"description" gorm:"type:varchar(512)"`
	// Keywords 分号分隔的关键词，模型广场「路由策略」卡片下方展示（如 "编程;长上下文;Agent"）
	Keywords    string `json:"keywords" gorm:"type:varchar(512)"`
	CreatedTime int64  `json:"created_time" gorm:"bigint"`
	UpdatedTime int64  `json:"updated_time" gorm:"bigint"`
}

// ---------- 分数 → tier → 模型 解析 ----------

type scoreBand struct {
	lo   float64
	hi   float64
	tier int
}

// parseScoreBands 解析 "0-3:5,3-5:4,..." 为有序档位列表。容错：跳过非法片段。
func parseScoreBands(raw string) []scoreBand {
	bands := make([]scoreBand, 0)
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		colon := strings.LastIndex(part, ":")
		if colon < 0 {
			continue
		}
		tier, err := strconv.Atoi(strings.TrimSpace(part[colon+1:]))
		if err != nil {
			continue
		}
		rangePart := strings.TrimSpace(part[:colon])
		dash := strings.Index(rangePart, "-")
		if dash <= 0 {
			continue
		}
		lo, err1 := strconv.ParseFloat(strings.TrimSpace(rangePart[:dash]), 64)
		hi, err2 := strconv.ParseFloat(strings.TrimSpace(rangePart[dash+1:]), 64)
		if err1 != nil || err2 != nil {
			continue
		}
		bands = append(bands, scoreBand{lo: lo, hi: hi, tier: tier})
	}
	return bands
}

func (p *RoutingProfile) tierModel(tier int) string {
	switch tier {
	case 1:
		return p.Tier1Model
	case 2:
		return p.Tier2Model
	case 3:
		return p.Tier3Model
	case 4:
		return p.Tier4Model
	case 5:
		return p.Tier5Model
	}
	return ""
}

// DefaultModel 返回兜底模型（优先 tier3，否则第一个非空 tier），用于打分失败/无消息时。
func (p *RoutingProfile) DefaultModel() (string, int) {
	if m := p.tierModel(3); m != "" {
		return m, 3
	}
	for t := 1; t <= 5; t++ {
		if m := p.tierModel(t); m != "" {
			return m, t
		}
	}
	return "", 0
}

// ResolveModel 把难度分数(0-10)映射到具体模型。返回 (模型名, tier)。
// 与 tierflow-core resolver._resolve_tier_model 对齐：非末档用 [lo,hi)，末档用 [lo,hi]，
// 无匹配或该 tier 模型为空时兜底到 tier3。
func (p *RoutingProfile) ResolveModel(score float64) (string, int) {
	bands := parseScoreBands(p.ScoreBands)
	matchedTier := 0
	for i, b := range bands {
		isLast := i == len(bands)-1
		if (b.lo <= score && score < b.hi) || (isLast && b.lo <= score && score <= b.hi) {
			matchedTier = b.tier
			break
		}
	}
	if matchedTier == 0 {
		return p.DefaultModel()
	}
	if m := p.tierModel(matchedTier); m != "" {
		return m, matchedTier
	}
	// 该档模型未配置 → 兜底默认档。返回兜底档自己的 tier 而非 matchedTier，
	// 否则日志/监控里 tier 与实际生效的模型(组)错位，按 tier 归因必然错。
	return p.DefaultModel()
}

// ---------- 内存缓存（alias -> profile，仅含启用项） ----------

var (
	routingProfileCacheLock sync.RWMutex
	routingProfileByAlias   map[string]*RoutingProfile
	routingAliasList        []string // 启用 profile 的别名(展示用，原样大小写，去重)
	routingProfilesLoaded   bool
)

// reloadRoutingProfileCache 从 DB 重建 alias->profile 缓存。
func reloadRoutingProfileCache() error {
	var profiles []*RoutingProfile
	if err := DB.Where("enabled = ?", true).Find(&profiles).Error; err != nil {
		return err
	}
	aliasMap := make(map[string]*RoutingProfile)
	aliasList := make([]string, 0)
	seen := make(map[string]bool)
	for _, p := range profiles {
		for _, raw := range strings.Split(p.Aliases, ",") {
			a := strings.TrimSpace(raw)
			if a == "" {
				continue
			}
			low := strings.ToLower(a)
			aliasMap[low] = p
			if !seen[low] {
				seen[low] = true
				aliasList = append(aliasList, a)
			}
		}
	}
	routingProfileCacheLock.Lock()
	routingProfileByAlias = aliasMap
	routingAliasList = aliasList
	routingProfilesLoaded = true
	routingProfileCacheLock.Unlock()
	return nil
}

// GetRoutingAliasList 返回所有启用 profile 的别名(展示用)。线程安全 + 惰性加载。
func GetRoutingAliasList() []string {
	routingProfileCacheLock.RLock()
	loaded := routingProfilesLoaded
	routingProfileCacheLock.RUnlock()
	if !loaded {
		_ = reloadRoutingProfileCache()
	}
	routingProfileCacheLock.RLock()
	out := make([]string, len(routingAliasList))
	copy(out, routingAliasList)
	routingProfileCacheLock.RUnlock()
	return out
}

// ShouldExposeUpstreamModels 是否向用户暴露上游模型。默认 false(隐藏，只暴露路由别名)。
func ShouldExposeUpstreamModels() bool {
	common.OptionMapRWMutex.RLock()
	v := common.OptionMap["ExposeUpstreamModels"]
	common.OptionMapRWMutex.RUnlock()
	return v == "true"
}

// ShouldRestrictDirectModelCall 是否禁止用户直接点名调用真实模型（仅允许路由别名）。
// 默认 false。开启后，非管理员请求非别名模型会在 AutoRoute 中间件被拒。
// 与 ShouldExposeUpstreamModels 相互独立：本项管"能不能调用"，后者管"列表里看不看得见"。
func ShouldRestrictDirectModelCall() bool {
	common.OptionMapRWMutex.RLock()
	v := common.OptionMap["RestrictDirectModelCall"]
	common.OptionMapRWMutex.RUnlock()
	return v == "true"
}

// ApplyRoutingModelVisibility 对用户侧模型名列表做可见性变换：
// 始终加入启用的路由别名；隐藏上游时(默认)仅保留别名。供 /v1/models、/api/user/self/models 等共用。
func ApplyRoutingModelVisibility(models []string) []string {
	aliases := GetRoutingAliasList()
	expose := ShouldExposeUpstreamModels()
	seen := make(map[string]bool)
	out := make([]string, 0, len(models)+len(aliases))
	if expose {
		for _, m := range models {
			low := strings.ToLower(m)
			if !seen[low] {
				seen[low] = true
				out = append(out, m)
			}
		}
	} else {
		aliasSet := make(map[string]bool)
		for _, a := range aliases {
			aliasSet[strings.ToLower(a)] = true
		}
		for _, m := range models {
			low := strings.ToLower(m)
			if aliasSet[low] && !seen[low] {
				seen[low] = true
				out = append(out, m)
			}
		}
	}
	for _, a := range aliases {
		low := strings.ToLower(a)
		if !seen[low] {
			seen[low] = true
			out = append(out, a)
		}
	}
	return out
}

// ApplyRoutingPricingVisibility 对模型广场(定价列表)做可见性变换：隐藏上游时只展示
// 路由别名(用其代表档位模型的定价作为展示价)；暴露时在原定价基础上追加别名行。
func ApplyRoutingPricingVisibility(pricing []Pricing) []Pricing {
	aliases := GetRoutingAliasList()
	if len(aliases) == 0 {
		return pricing
	}
	aliasRows := buildAliasPricing(pricing, aliases)
	// 始终返回「支持的模型」目录 + 路由别名行：模型广场分两段展示(Part1 路由策略/Part2 支持的模型)。
	// 不暴露上游时(默认)，别名行清掉各档位真实模型，仅保留 score_bands/描述/能力，做到彻底抽象。
	if !ShouldExposeUpstreamModels() {
		for i := range aliasRows {
			aliasRows[i].RoutingTiers = nil
		}
	}
	return append(pricing, aliasRows...)
}

// buildAliasPricing 为每个 profile 构造一行定价(一个 profile 一张卡，即使它配了多个别名)：
// 取代表档位模型的基础信息(分组/图标/能力)，描述用 profile 说明、标记为路由别名(不展示单一价)，
// RoutingAliases 带上该 profile 的全部调用别名、并带各档位模型定价(详情用)。
func buildAliasPricing(pricing []Pricing, aliases []string) []Pricing {
	byName := make(map[string]Pricing, len(pricing))
	for _, p := range pricing {
		byName[p.ModelName] = p
	}
	rows := make([]Pricing, 0, len(aliases))
	seen := make(map[string]bool) // 按 profile 去重(slug)：一个 profile 只出一张卡
	for _, alias := range aliases {
		profile := GetRoutingProfileByAlias(alias)
		if profile == nil {
			continue
		}
		if seen[profile.Slug] {
			continue
		}
		seen[profile.Slug] = true
		// 各档位定价(详情展示) + 代表行的基础字段(分组/图标/能力)
		tiers := make([]RoutingTierEntry, 0, 5)
		var rep *Pricing
		for _, tier := range []int{1, 2, 3, 4, 5} {
			m := profile.tierModel(tier)
			if m == "" {
				continue
			}
			var tp *Pricing
			if p, ok := byName[m]; ok {
				clone := p
				tp = &clone
				if rep == nil || tier == 3 {
					base := p
					rep = &base // 代表行优先 tier3
				}
			}
			tiers = append(tiers, RoutingTierEntry{Tier: tier, ModelName: m, Pricing: tp})
		}
		row := Pricing{}
		if rep != nil {
			row = *rep // 继承分组/图标/厂商/能力等
		}
		row.ModelName = alias
		row.Description = profile.Description
		row.IsRoutingAlias = true
		row.RoutingTiers = tiers
		// Name 已并入 Slug：优先用旧 Name（历史数据），为空则回退 Slug 作展示名。
		if profile.Name != "" {
			row.RoutingName = profile.Name
		} else {
			row.RoutingName = profile.Slug
		}
		row.ScoreBands = profile.ScoreBands
		row.RoutingKeywords = profile.Keywords
		row.RoutingAliases = profile.Aliases
		rows = append(rows, row)
	}
	return rows
}

// InitRoutingProfileCache 启动时预热缓存（可选，未调用时首个请求会惰性加载）。
func InitRoutingProfileCache() error {
	return reloadRoutingProfileCache()
}

// InvalidateRoutingProfileCache 写操作后刷新缓存。
func InvalidateRoutingProfileCache() {
	if err := reloadRoutingProfileCache(); err != nil {
		common.SysError("failed to reload routing profile cache: " + err.Error())
	}
}

// GetRoutingProfileByAlias 按别名查启用的 profile，未命中返回 nil。线程安全 + 惰性加载。
func GetRoutingProfileByAlias(alias string) *RoutingProfile {
	routingProfileCacheLock.RLock()
	loaded := routingProfilesLoaded
	m := routingProfileByAlias
	routingProfileCacheLock.RUnlock()

	if !loaded {
		if err := reloadRoutingProfileCache(); err != nil {
			return nil
		}
		routingProfileCacheLock.RLock()
		m = routingProfileByAlias
		routingProfileCacheLock.RUnlock()
	}
	if m == nil {
		return nil
	}
	return m[strings.ToLower(strings.TrimSpace(alias))]
}

// ---------- CRUD ----------

func GetAllRoutingProfiles() ([]*RoutingProfile, error) {
	var profiles []*RoutingProfile
	err := DB.Order("id desc").Find(&profiles).Error
	return profiles, err
}

// GetAllRoutingAliases 返回所有 profile(含已禁用)的全部调用别名(去空格,原样大小写)。
// 用于看板「模型明细」视图剔除"仅别名、无真实上游"的历史行,避免别名被当成模型展示。
func GetAllRoutingAliases() ([]string, error) {
	var profiles []*RoutingProfile
	if err := DB.Find(&profiles).Error; err != nil {
		return nil, err
	}
	aliases := make([]string, 0)
	for _, p := range profiles {
		for _, raw := range strings.Split(p.Aliases, ",") {
			if a := strings.TrimSpace(raw); a != "" {
				aliases = append(aliases, a)
			}
		}
	}
	return aliases, nil
}

// GetRoutingAliasesBySlug 返回指定 profile（按 slug）配置的全部调用别名(去空格)。
// 用于看板按请求方案过滤 quota_data（其 model_name 对路由请求即为别名）。
func GetRoutingAliasesBySlug(slug string) ([]string, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, nil
	}
	p := &RoutingProfile{}
	if err := DB.First(p, "slug = ?", slug).Error; err != nil {
		return nil, err
	}
	aliases := make([]string, 0)
	for _, raw := range strings.Split(p.Aliases, ",") {
		if a := strings.TrimSpace(raw); a != "" {
			aliases = append(aliases, a)
		}
	}
	return aliases, nil
}

func GetRoutingProfileById(id int) (*RoutingProfile, error) {
	if id == 0 {
		return nil, errors.New("id 不能为空")
	}
	p := &RoutingProfile{}
	err := DB.First(p, "id = ?", id).Error
	return p, err
}

func (p *RoutingProfile) Insert() error {
	p.CreatedTime = common.GetTimestamp()
	p.UpdatedTime = p.CreatedTime
	err := DB.Create(p).Error
	if err == nil {
		InvalidateRoutingProfileCache()
	}
	return err
}

func (p *RoutingProfile) Update() error {
	p.UpdatedTime = common.GetTimestamp()
	// Save 写全字段，保证 Enabled=false / 清空 tier 等零值能落库
	err := DB.Save(p).Error
	if err == nil {
		InvalidateRoutingProfileCache()
	}
	return err
}

func DeleteRoutingProfileById(id int) error {
	if id == 0 {
		return errors.New("id 不能为空")
	}
	err := DB.Delete(&RoutingProfile{Id: id}).Error
	if err == nil {
		InvalidateRoutingProfileCache()
	}
	return err
}
