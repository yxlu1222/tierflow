package controller

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	"github.com/Zer0Echo/tierflow-core/setting/billing_setting"
	"github.com/Zer0Echo/tierflow-core/setting/provider_cost_setting"
	"github.com/Zer0Echo/tierflow-core/setting/ratio_setting"
)

// 计费表达式配置的保存前校验 + 保存后亏损预警。
//
// 校验(阻断):售价/成本表达式 map 的每个值都编译 + 样本向量试算,断言非负。
// 亏损预警(非阻断):按 (渠道,模型) 用同一组样本 token 向量分别算售价 quota(GroupRatio=1
// 基准)与成本 quota,任一样本 cost>=price 即预警。这是【抽样启发式】——分层表达式无法
// 静态比大小,只能采样。

// pricingSampleVectors 与 billing_setting.SmokeTestExpr 同构的样本 token 向量。
func pricingSampleVectors() []billingexpr.TokenParams {
	return []billingexpr.TokenParams{
		{P: 1000, C: 1000, Len: 1000},
		{P: 100000, C: 10000, Len: 100000},
		{P: 1000000, C: 100000, Len: 1000000},
	}
}

// validateBillingExprMapJSON 校验售价表达式 map(键->表达式)。
func validateBillingExprMapJSON(jsonStr string) error {
	return validateExprMapJSON(jsonStr, billing_setting.SmokeTestExpr)
}

// validateCostExprMapJSON 校验成本表达式 map(键->表达式)。
func validateCostExprMapJSON(jsonStr string) error {
	return validateExprMapJSON(jsonStr, provider_cost_setting.SmokeTestExpr)
}

func validateExprMapJSON(jsonStr string, smoke func(string) error) error {
	if strings.TrimSpace(jsonStr) == "" {
		return nil
	}
	m := map[string]string{}
	if err := common.UnmarshalJsonStr(jsonStr, &m); err != nil {
		return fmt.Errorf("配置格式非法: %w", err)
	}
	for key, expr := range m {
		if strings.TrimSpace(expr) == "" {
			continue
		}
		if err := smoke(expr); err != nil {
			return fmt.Errorf("表达式 [%s] 校验失败: %w", key, err)
		}
	}
	return nil
}

// parseChannelModelKey 解析 "<channelId>|<model>" 或 "<model>"。
func parseChannelModelKey(key string) (channelId int, model string) {
	if idx := strings.IndexByte(key, '|'); idx > 0 {
		if id, err := strconv.Atoi(key[:idx]); err == nil {
			return id, key[idx+1:]
		}
	}
	return 0, key
}

// sellingQuotaSample 计算 (channelId, model) 在样本向量下的售价 quota(GroupRatio=1 基准)。
// tiered(含渠道售价覆盖)走表达式;否则按模型倍率估算($/1M = modelRatio*2, 与日志基准价一致)。
func sellingQuotaSample(channelId int, m string, v billingexpr.TokenParams) (int, bool) {
	if billing_setting.GetBillingModeForChannel(channelId, m) == billing_setting.BillingModeTieredExpr {
		expr, ok := billing_setting.GetBillingExprForChannel(channelId, m)
		if !ok || strings.TrimSpace(expr) == "" {
			return 0, false
		}
		raw, _, err := billingexpr.RunExprWithRequest(expr, v, billingexpr.RequestInput{})
		if err != nil {
			return 0, false
		}
		return billingexpr.QuotaRound(raw / 1_000_000.0 * common.QuotaPerUnit), true
	}
	// ratio 估算:$/1M 输入价 = modelRatio*2;补全按 completionRatio。
	modelRatio, ok, _ := ratio_setting.GetModelRatio(m)
	if !ok {
		return 0, false
	}
	completionRatio := ratio_setting.GetCompletionRatio(m)
	inputPerMillion := modelRatio * 2
	raw := v.P*inputPerMillion + v.C*inputPerMillion*completionRatio
	return billingexpr.QuotaRound(raw / 1_000_000.0 * common.QuotaPerUnit), true
}

// computePricingLossWarnings 保存后按 (渠道,模型) 采样比较售价与成本,返回非阻断预警。
func computePricingLossWarnings() []string {
	vectors := pricingSampleVectors()
	warned := map[string]bool{}

	// 枚举待检查的 (channelId, model):成本表达式键 ∪ 渠道售价覆盖键。
	keys := map[string]struct{}{}
	for k := range provider_cost_setting.GetCostExprCopy() {
		keys[k] = struct{}{}
	}
	for k := range billing_setting.GetChannelBillingExprCopy() {
		keys[k] = struct{}{}
	}

	warnings := []string{}
	for key := range keys {
		channelId, m := parseChannelModelKey(key)
		label := m
		if channelId > 0 {
			label = fmt.Sprintf("渠道%d · %s", channelId, m)
		}
		if warned[label] {
			continue
		}
		for _, v := range vectors {
			sellQuota, sok := sellingQuotaSample(channelId, m, v)
			costQuota, cok := model.ComputeProviderCostExpr(channelId, m, v, billingexpr.RequestInput{},
				int(v.P), int(v.C), 0, 0)
			if !sok || !cok {
				continue
			}
			if costQuota >= sellQuota && sellQuota >= 0 {
				warnings = append(warnings, fmt.Sprintf("%s: 采样成本(%d) ≥ 售价(%d),可能亏损", label, costQuota, sellQuota))
				warned[label] = true
				break
			}
		}
	}
	sort.Strings(warnings)
	return warnings
}
