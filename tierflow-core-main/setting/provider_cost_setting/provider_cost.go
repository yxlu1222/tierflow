package provider_cost_setting

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	"github.com/Zer0Echo/tierflow-core/setting/config"
	"github.com/samber/lo"
)

// 上游成本(渠道×模型)表达式配置。
//
// 与售价的分层计费(billing_setting)完全对齐：成本也用 billingexpr 表达式描述，
// 支持分层 / len 条件 / header/param / image/audio 拆分变量。表达式系数是「每百万
// token 的上游成本(¥,Rule 8 单币种)」，与售价表达式同一约定。
//
// 键(key)有两种：
//   - 模型全局:            "<model>"                （如 "gpt-4o"）
//   - 渠道特定(优先):      "<channelId>|<model>"     （如 "12|gpt-4o"）
//
// 现状:渠道特定键【当前没有前端入口写入】。产品原则是「一个模型一套价」，成本
// 与售价都统一在模型管理页按模型配置。模型编辑对话框保存时会原样保留已存在的
// 渠道键(含改名迁移)，但不产生新的渠道键。
//
// 解析回退链(在上层 service 编排)：
//
//	(channel,model) 表达式 -> (global,model) 表达式 -> 遗留 ProviderModelCost 扁平配置 -> 未配置(成本=售价,毛利0)
//
// 成本换算为 quota 时【不乘分组倍率】——上游不关心我们的用户分组。
const (
	CostExprField = "cost_expr"
)

// ProviderCostSetting 由 config.GlobalConfig.Register 管理。
// DB key: provider_cost_setting.cost_expr
type ProviderCostSetting struct {
	CostExpr map[string]string `json:"cost_expr"`
}

var providerCostSetting = ProviderCostSetting{
	CostExpr: make(map[string]string),
}

func init() {
	config.GlobalConfig.Register("provider_cost_setting", &providerCostSetting)
}

// ChannelKey 构造渠道特定成本配置的键。channelId<=0 时退化为模型全局键。
func ChannelKey(channelId int, model string) string {
	if channelId <= 0 {
		return model
	}
	return strconv.Itoa(channelId) + "|" + model
}

// GetCostExpr 返回 (channelId, model) 的成本表达式，按 渠道特定 -> 模型全局 回退。
// ok=false 表示没有配置表达式(上层应继续回退到遗留扁平配置)。
func GetCostExpr(channelId int, model string) (string, bool) {
	if channelId > 0 {
		if e, ok := providerCostSetting.CostExpr[ChannelKey(channelId, model)]; ok && strings.TrimSpace(e) != "" {
			return e, true
		}
	}
	if e, ok := providerCostSetting.CostExpr[model]; ok && strings.TrimSpace(e) != "" {
		return e, true
	}
	return "", false
}

// GetCostExprCopy 返回成本表达式映射的浅拷贝(用于导出/展示)。
func GetCostExprCopy() map[string]string {
	return lo.Assign(providerCostSetting.CostExpr)
}

// SmokeTestExpr 校验成本表达式：编译 + 样本 token 向量试算，断言非负。
// 供保存前校验调用(与 billing_setting.SmokeTestExpr 共用 billingexpr.SmokeTest)。
func SmokeTestExpr(exprStr string) error {
	return billingexpr.SmokeTest(exprStr)
}
