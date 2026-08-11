package service

import (
	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
	"github.com/Zer0Echo/tierflow-core/setting/billing_setting"

	"github.com/gin-gonic/gin"
)

// reResolveTieredSnapshotForChannel 在结算前按「实际服务渠道」重新解析售价。
//
// 铁律:售价也在结算层按 relayInfo.ChannelId(实际成功服务的渠道)重新解析。
// 若该 (渠道, 模型) 配了售价覆盖表达式(billing_setting.ChannelBillingExpr)，就用它
// 重建 tiered 快照(沿用当前分组倍率)，使 TryTieredSettle 按渠道覆盖结算——从而修复
// 「故障转移 A→B 仍按渠道 A 计价」隐患(预扣在选渠道前只算一次)。
//
// 安全性:GetChannelBillingExpr 在未配置任何渠道覆盖时恒返回 false，此函数即为 no-op，
// 完全不改动既有计费路径。
//
// 现状(重要):渠道售价覆盖当前【没有任何前端入口】。模型组管理页的「售价覆盖 /
// 费用」两字段已在 9bc6b841 移除，产品原则收敛为「一个模型一套价」——定价统一
// 在模型管理页按模型配置。billing_setting.ChannelBillingExpr 因此恒为空，本函数
// 在生产中不会命中。后端能力有意保留(移除会牵动结算主链路)，但在恢复前端入口
// 之前，不要依赖它来实现按渠道差异化定价。
func reResolveTieredSnapshotForChannel(ctx *gin.Context, relayInfo *relaycommon.RelayInfo) {
	channelId := relayInfo.ChannelId
	modelName := relayInfo.OriginModelName

	exprStr, ok := billing_setting.GetChannelBillingExpr(channelId, modelName)
	if !ok {
		return // 无渠道售价覆盖，沿用预扣冻结的模型全局快照 / ratio 路径
	}

	// 已按该覆盖表达式冻结过 -> 无需重建。
	if snap := relayInfo.TieredBillingSnapshot; snap != nil &&
		snap.BillingMode == billing_setting.BillingModeTieredExpr && snap.ExprString == exprStr {
		return
	}

	groupRatio := relayInfo.PriceData.GroupRatioInfo.GroupRatio
	relayInfo.TieredBillingSnapshot = &billingexpr.BillingSnapshot{
		BillingMode:  billing_setting.BillingModeTieredExpr,
		ModelName:    modelName,
		ExprString:   exprStr,
		ExprHash:     billingexpr.ExprHashString(exprStr),
		GroupRatio:   groupRatio,
		QuotaPerUnit: common.QuotaPerUnit,
		ExprVersion:  billingexpr.ExprVersion(exprStr),
	}

	// 确保结算时有 RequestInput 供表达式的 header()/param() 使用。
	// 预扣走 tiered 路径时已设置;ratio 全局 + 渠道覆盖 的情形这里补建。
	if relayInfo.BillingRequestInput == nil {
		input := billingexpr.RequestInput{Headers: relayInfo.RequestHeaders}
		if ctx != nil && ctx.Request != nil {
			if storage, err := common.GetBodyStorage(ctx); err == nil {
				if body, bErr := storage.Bytes(); bErr == nil {
					input.Body = body
				}
			}
		}
		relayInfo.BillingRequestInput = &input
	}
}
