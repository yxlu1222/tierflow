package model

import (
	"sort"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"
)

// ModelHealth is the aggregated routing health of a single model across every
// channel (upstream) that serves it, in any group.
type ModelHealth struct {
	Model             string `json:"model"`
	TotalChannels     int    `json:"total_channels"`
	AvailableChannels int    `json:"available_channels"`
	CoolingChannels   int    `json:"cooling_channels"`
	State             string `json:"state"` // healthy | degraded | down
	// Channels is the per-channel health of every upstream serving this model,
	// worst-first, for the model detail view.
	Channels []ProviderHealth `json:"channels"`
}

// ProviderHealth is the health of a single channel (an upstream provider
// account), overlaying the circuit-breaker state onto the configured channel.
type ProviderHealth struct {
	ChannelId    int    `json:"channel_id"`
	ChannelName  string `json:"channel_name"`
	ChannelType  int    `json:"channel_type"`
	ProviderName string `json:"provider_name"`
	State        string `json:"state"` // healthy | probing | degraded | cooling
	IsMultiKey   bool   `json:"is_multi_key"`
	TotalKeys    int    `json:"total_keys"`
	CoolingKeys  int    `json:"cooling_keys"`
	Models       int    `json:"models"`
	CooldownLeft int64  `json:"cooldown_left"` // seconds until recovery, 0 if not cooling
}

// channelKeyStats reports, for a multi-key channel, how many enabled keys are
// available vs cooling in the breaker, plus the soonest cooldown to recover.
func channelKeyStats(ch *Channel) (totalEnabled, cooling, available int, soonestCoolingLeft int64) {
	if !ch.ChannelInfo.IsMultiKey {
		return 0, 0, 0, 0
	}
	size := ch.ChannelInfo.MultiKeySize
	if size <= 0 {
		size = len(ch.GetKeys())
	}
	statusList := ch.ChannelInfo.MultiKeyStatusList
	for i := 0; i < size; i++ {
		st := common.ChannelStatusEnabled
		if statusList != nil {
			if s, ok := statusList[i]; ok {
				st = s
			}
		}
		if st != common.ChannelStatusEnabled {
			continue // permanently disabled key — not a breaker concern
		}
		totalEnabled++
		if routehealth.IsAvailable(ch.Id, i) {
			available++
			continue
		}
		cooling++
		if left := routehealth.CooldownRemainingSeconds(ch.Id, i); left > 0 {
			if soonestCoolingLeft == 0 || left < soonestCoolingLeft {
				soonestCoolingLeft = left
			}
		}
	}
	return
}

// channelRoutable reports whether a channel can currently take traffic. For a
// multi-key channel this is driven purely by key-level availability (a single
// failing key must not sideline the whole channel); for a single-key channel it
// is the channel-scope breaker.
func channelRoutable(ch *Channel) bool {
	if ch.ChannelInfo.IsMultiKey {
		_, _, available, _ := channelKeyStats(ch)
		return available > 0
	}
	return routehealth.IsChannelAvailable(ch.Id)
}

func mapBreakerState(state string) string {
	switch state {
	case "open":
		return "cooling"
	case "half_open":
		return "probing"
	default:
		return "healthy"
	}
}

// severityRank orders states worst-first for display.
func severityRank(state string) int {
	switch state {
	case "down", "cooling":
		return 0
	case "degraded", "probing":
		return 1
	default:
		return 2
	}
}

func buildProviderHealth(ch *Channel) ProviderHealth {
	ph := ProviderHealth{
		ChannelId:    ch.Id,
		ChannelName:  ch.Name,
		ChannelType:  ch.Type,
		ProviderName: constant.GetChannelTypeName(ch.Type),
		IsMultiKey:   ch.ChannelInfo.IsMultiKey,
		Models:       len(ch.GetModels()),
	}
	if ch.ChannelInfo.IsMultiKey {
		total, cooling, available, soonest := channelKeyStats(ch)
		ph.TotalKeys = total
		ph.CoolingKeys = cooling
		switch {
		case available == 0 && total > 0:
			ph.State = "cooling"
			ph.CooldownLeft = soonest
		case cooling > 0:
			ph.State = "degraded"
			ph.CooldownLeft = soonest
		default:
			ph.State = "healthy"
		}
		return ph
	}
	ph.State = mapBreakerState(routehealth.StateOf(ch.Id, -1))
	ph.CooldownLeft = routehealth.CooldownRemainingSeconds(ch.Id, -1)
	// 单 key 渠道同样报告密钥口径：1 把 key，冷却时 0 可用。key 冗余是高可用的
	// 一环（单 key 被限流即整渠道不可路由），此前该分支不赋值、前端只好显示 "—"，
	// 把"没有 key 级冗余"这个事实藏了起来。
	ph.TotalKeys = 1
	if ph.State == "cooling" {
		ph.CoolingKeys = 1
	}
	return ph
}

// BuildModelChannelHealth returns the per-channel breaker health of every
// enabled channel that serves modelName (in any group), worst-first. Used by the
// model detail view; overlays breaker state onto the configured channels without
// building health for every other model.
func BuildModelChannelHealth(modelName string) []ProviderHealth {
	var abilities []Ability
	if err := DB.Where("model = ? AND enabled = ?", modelName, true).Find(&abilities).Error; err != nil {
		return nil
	}
	channelIds := make([]int, 0, len(abilities))
	seen := make(map[int]bool, len(abilities))
	for _, a := range abilities {
		if !seen[a.ChannelId] {
			seen[a.ChannelId] = true
			channelIds = append(channelIds, a.ChannelId)
		}
	}
	if len(channelIds) == 0 {
		return nil
	}

	var channels []*Channel
	if err := DB.Where("id IN ? AND status = ?", channelIds, common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil
	}
	out := make([]ProviderHealth, 0, len(channels))
	for _, ch := range channels {
		out = append(out, buildProviderHealth(ch))
	}
	sort.Slice(out, func(i, j int) bool {
		ri, rj := severityRank(out[i].State), severityRank(out[j].State)
		if ri != rj {
			return ri < rj
		}
		return out[i].ChannelName < out[j].ChannelName
	})
	return out
}

// BuildRouteHealth aggregates breaker state with the configured channels and
// abilities into model-level and provider(channel)-level health for the
// route-health endpoint. It reads from the database so it is correct regardless
// of whether the in-memory channel cache (MemoryCacheEnabled) is on.
func BuildRouteHealth() (models []ModelHealth, providers []ProviderHealth) {
	var channels []*Channel
	if err := DB.Where("status = ?", common.ChannelStatusEnabled).Find(&channels).Error; err != nil {
		return nil, nil
	}
	channelById := make(map[int]*Channel, len(channels))
	providerByChannel := make(map[int]ProviderHealth, len(channels))
	for _, ch := range channels {
		channelById[ch.Id] = ch
		ph := buildProviderHealth(ch)
		providerByChannel[ch.Id] = ph
		providers = append(providers, ph)
	}

	// Model health — union of the enabled channels serving each model.
	var abilities []Ability
	DB.Where("enabled = ?", true).Find(&abilities)
	modelChannels := make(map[string]map[int]bool)
	for _, a := range abilities {
		if _, ok := channelById[a.ChannelId]; !ok {
			continue // channel not enabled
		}
		set := modelChannels[a.Model]
		if set == nil {
			set = make(map[int]bool)
			modelChannels[a.Model] = set
		}
		set[a.ChannelId] = true
	}
	for modelName, set := range modelChannels {
		mh := ModelHealth{Model: modelName, TotalChannels: len(set)}
		for id := range set {
			ch := channelById[id]
			if ch == nil {
				continue
			}
			if channelRoutable(ch) {
				mh.AvailableChannels++
			} else {
				mh.CoolingChannels++
			}
			if ph, ok := providerByChannel[id]; ok {
				mh.Channels = append(mh.Channels, ph)
			}
		}
		// Worst-first so the detail view surfaces cooling channels at the top.
		sort.Slice(mh.Channels, func(i, j int) bool {
			ri, rj := severityRank(mh.Channels[i].State), severityRank(mh.Channels[j].State)
			if ri != rj {
				return ri < rj
			}
			return mh.Channels[i].ChannelName < mh.Channels[j].ChannelName
		})
		switch {
		case mh.AvailableChannels == 0:
			mh.State = "down"
		case mh.CoolingChannels > 0:
			mh.State = "degraded"
		default:
			mh.State = "healthy"
		}
		models = append(models, mh)
	}

	sort.Slice(models, func(i, j int) bool {
		ri, rj := severityRank(models[i].State), severityRank(models[j].State)
		if ri != rj {
			return ri < rj
		}
		return models[i].Model < models[j].Model
	})
	sort.Slice(providers, func(i, j int) bool {
		ri, rj := severityRank(providers[i].State), severityRank(providers[j].State)
		if ri != rj {
			return ri < rj
		}
		return providers[i].ChannelName < providers[j].ChannelName
	})
	return models, providers
}
