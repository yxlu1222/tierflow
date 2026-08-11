package service

import (
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
	"github.com/Zer0Echo/tierflow-core/setting/provider_cost_setting"
)

// settlementCostModel 返回用于成本计价的上游模型名——实际计费的真实上游模型，而非
// 用户侧别名(自动路由会把日志模型名改写成别名)。成本配置按「渠道 × 上游模型」键控，
// 因此必须用这个真实上游名，不能用日志里的别名。优先 UpstreamModelName，回退 OriginModelName。
func settlementCostModel(relayInfo *relaycommon.RelayInfo) string {
	if relayInfo.UpstreamModelName != "" {
		return relayInfo.UpstreamModelName
	}
	return relayInfo.OriginModelName
}

// resolveProviderCostFromUsage 结算层按「实际服务渠道 × 实际计费上游模型」解析上游成本
// (quota 单位)，返回值可直接作为 RecordConsumeLogParams.ProviderCost(结算层权威值)。
//
// 铁律:成本在结算层按 relayInfo.ChannelId(实际成功服务的渠道)重新解析，天然规避
// 「故障转移 A→B 仍按渠道 A 计价」。成本换算【不乘分组倍率】。
// 未配置成本(表达式与遗留扁平配置均无)时，默认 成本=售价(quota)，毛利0。
func resolveProviderCostFromUsage(relayInfo *relaycommon.RelayInfo, usage *dto.Usage, isClaudeUsageSemantic bool, quota int) *int {
	if usage == nil {
		c := quota
		return &c
	}
	channelId := relayInfo.ChannelId
	costModel := settlementCostModel(relayInfo)

	var usedVars map[string]bool
	if exprStr, ok := provider_cost_setting.GetCostExpr(channelId, costModel); ok {
		usedVars = billingexpr.UsedVars(exprStr)
	}
	params := BuildTieredTokenParams(usage, isClaudeUsageSemantic, usedVars)

	cacheRead := usage.PromptTokensDetails.CachedTokens
	cacheWrite := usage.PromptTokensDetails.CachedCreationTokens
	return resolveProviderCostFromParams(relayInfo, params, quota,
		usage.PromptTokens, usage.CompletionTokens, cacheRead, cacheWrite)
}

// resolveProviderCostFromParams 与 resolveProviderCostFromUsage 同语义，但接受已构建好的
// TokenParams(用于 realtime wss 等无 dto.Usage 的路径)。
func resolveProviderCostFromParams(relayInfo *relaycommon.RelayInfo, params billingexpr.TokenParams, quota int,
	promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens int) *int {
	channelId := relayInfo.ChannelId
	costModel := settlementCostModel(relayInfo)

	requestInput := billingexpr.RequestInput{}
	if relayInfo.BillingRequestInput != nil {
		requestInput = *relayInfo.BillingRequestInput
	}

	cost, configured := model.ComputeProviderCostExpr(channelId, costModel, params, requestInput,
		promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens)
	if !configured {
		cost = quota
	}
	return &cost
}
