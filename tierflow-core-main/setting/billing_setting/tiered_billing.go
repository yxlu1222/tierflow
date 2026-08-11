package billing_setting

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	"github.com/Zer0Echo/tierflow-core/setting/config"
	"github.com/samber/lo"
)

const (
	BillingModeRatio      = "ratio"
	BillingModeTieredExpr = "tiered_expr"
	BillingModeField      = "billing_mode"
	BillingExprField      = "billing_expr"
)

// BillingSetting is managed by config.GlobalConfig.Register.
// DB keys: billing_setting.billing_mode, billing_setting.billing_expr,
//
//	billing_setting.channel_billing_expr
type BillingSetting struct {
	BillingMode map[string]string `json:"billing_mode"`
	BillingExpr map[string]string `json:"billing_expr"`
	// ChannelBillingExpr 是「渠道×模型」的售价覆盖表达式，键为 "<channelId>|<model>"。
	// 命中即视为该 (渠道,模型) 走 tiered_expr 计费，覆盖模型全局的 ratio/price/expr。
	// 这是「售价按渠道区分」的载体：与成本(provider_cost_setting)完全对称，都用 billingexpr。
	// 未命中则回退到模型全局配置。
	//
	// 现状:【当前没有任何前端入口写入此字段】。产品原则是「一个模型一套价」，
	// 定价统一在模型管理页按模型配置(见 9bc6b841)。此字段恒为空。
	ChannelBillingExpr map[string]string `json:"channel_billing_expr"`
}

var billingSetting = BillingSetting{
	BillingMode:        make(map[string]string),
	BillingExpr:        make(map[string]string),
	ChannelBillingExpr: make(map[string]string),
}

func init() {
	config.GlobalConfig.Register("billing_setting", &billingSetting)
}

// channelBillingKey 构造「渠道×模型」售价覆盖键。channelId<=0 退化为无覆盖。
func channelBillingKey(channelId int, model string) string {
	if channelId <= 0 {
		return ""
	}
	return strconv.Itoa(channelId) + "|" + model
}

// ---------------------------------------------------------------------------
// Read accessors (hot path, must be fast)
// ---------------------------------------------------------------------------

func GetBillingMode(model string) string {
	if mode, ok := billingSetting.BillingMode[model]; ok {
		return mode
	}
	return BillingModeRatio
}

func GetBillingExpr(model string) (string, bool) {
	expr, ok := billingSetting.BillingExpr[model]
	return expr, ok
}

// GetChannelBillingExpr 返回 (channelId, model) 的售价覆盖表达式(非空才算命中)。
func GetChannelBillingExpr(channelId int, model string) (string, bool) {
	key := channelBillingKey(channelId, model)
	if key == "" {
		return "", false
	}
	expr, ok := billingSetting.ChannelBillingExpr[key]
	if !ok || strings.TrimSpace(expr) == "" {
		return "", false
	}
	return expr, true
}

// GetBillingModeForChannel 按 渠道售价覆盖 -> 模型全局 回退返回计费模式。
// 存在渠道覆盖表达式时，该 (渠道,模型) 一律按 tiered_expr 计费。
func GetBillingModeForChannel(channelId int, model string) string {
	if _, ok := GetChannelBillingExpr(channelId, model); ok {
		return BillingModeTieredExpr
	}
	return GetBillingMode(model)
}

// GetBillingExprForChannel 按 渠道售价覆盖 -> 模型全局 回退返回计费表达式。
func GetBillingExprForChannel(channelId int, model string) (string, bool) {
	if expr, ok := GetChannelBillingExpr(channelId, model); ok {
		return expr, true
	}
	return GetBillingExpr(model)
}

func GetBillingModeCopy() map[string]string {
	return lo.Assign(billingSetting.BillingMode)
}

func GetBillingExprCopy() map[string]string {
	return lo.Assign(billingSetting.BillingExpr)
}

func GetChannelBillingExprCopy() map[string]string {
	return lo.Assign(billingSetting.ChannelBillingExpr)
}

func GetPricingSyncData(base map[string]any) map[string]any {
	extra := make(map[string]any, 2)
	if modes := GetBillingModeCopy(); len(modes) > 0 {
		extra[BillingModeField] = modes
	}
	if exprs := GetBillingExprCopy(); len(exprs) > 0 {
		extra[BillingExprField] = exprs
	}
	return lo.Assign(base, extra)
}

// ---------------------------------------------------------------------------
// Smoke test (called externally for validation before save)
// ---------------------------------------------------------------------------

// SmokeTestExpr validates a sale-price expression before save. Shared with the
// provider-cost validator via billingexpr.SmokeTest so the fixtures stay in sync.
func SmokeTestExpr(exprStr string) error {
	return billingexpr.SmokeTest(exprStr)
}
