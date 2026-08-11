package model

import (
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	"github.com/Zer0Echo/tierflow-core/setting/provider_cost_setting"
)

// 上游成本配置：option "ProviderModelCost" 存 JSON
//
//	{"deepseek-chat": {"input": 2, "output": 8}, ...}
//
// input/output 为「每百万 token 的上游成本」，单位与计费货币一致（与 QuotaPerUnit 对应）。
// per_request 为「每次调用的固定上游成本」(与售价 ModelPrice 同语义)；设置后按次
// 计成本，token 字段不再参与。计算出的 provider_cost 以 quota 单位存入 Log，
// 便于和 Quota(售价) 直接相减得毛利。

type ProviderModelCost struct {
	Input       float64 `json:"input"`
	Output      float64 `json:"output"`
	CachedInput float64 `json:"cached_input,omitempty"`
	PerRequest  float64 `json:"per_request,omitempty"`
}

var (
	providerCostMu  sync.Mutex
	providerCostMap map[string]ProviderModelCost
	providerCostRaw string
)

func getProviderModelCost(modelName string) (ProviderModelCost, bool) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ProviderModelCost"]
	common.OptionMapRWMutex.RUnlock()

	providerCostMu.Lock()
	defer providerCostMu.Unlock()
	if raw != providerCostRaw || providerCostMap == nil {
		m := map[string]ProviderModelCost{}
		if raw != "" {
			if err := common.UnmarshalJsonStr(raw, &m); err != nil {
				common.SysError("invalid ProviderModelCost config: " + err.Error())
			}
		}
		providerCostMap = m
		providerCostRaw = raw
	}
	c, ok := providerCostMap[modelName]
	return c, ok
}

// ComputeProviderCost 按上游成本配置计算本次请求成本（quota 单位）。
//   - promptTokens：非缓存输入 token（已扣除缓存读/写）
//   - cacheReadTokens：缓存命中(读) token，按 cached_input 计；未配缓存价则按 input 价(不免费)
//   - cacheWriteTokens：缓存写入 token，按 input 价计(避免漏算)
//
// 第二个返回值表示该模型是否有显式成本配置；未显式配置时，调用方默认用售价
// （成本=价格→毛利0），避免未配置成本的模型显示虚假的 100% 毛利。
func ComputeProviderCost(modelName string, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens int) (int, bool) {
	cost, ok := getProviderModelCost(modelName)
	if !ok {
		return 0, false
	}
	// 按次成本：固定每调用成本，token 数无关(与售价 ModelPrice 的按次语义对齐,
	// 换算 quota 同样不乘分组倍率)。QuotaRound 与表达式路径一致,避免二进制
	// 浮点乘积被 int() 截断少记 1 quota。
	if cost.PerRequest > 0 {
		q := billingexpr.QuotaRound(cost.PerRequest * common.QuotaPerUnit)
		if q < 0 {
			q = 0
		}
		return q, true
	}
	cachedRate := cost.CachedInput
	if cachedRate <= 0 {
		cachedRate = cost.Input
	}
	// promptTokens 在不同计费流程下可能含或不含缓存 token，统一推导非缓存输入，
	// 避免缓存 token 被重复计价。
	nonCached := promptTokens - cacheReadTokens - cacheWriteTokens
	if nonCached < 0 {
		nonCached = promptTokens // prompt 已不含缓存
	}
	if nonCached < 0 {
		nonCached = 0
	}
	currency := (float64(nonCached)*cost.Input +
		float64(cacheReadTokens)*cachedRate +
		float64(cacheWriteTokens)*cost.Input +
		float64(completionTokens)*cost.Output) / 1_000_000.0
	q := int(currency * common.QuotaPerUnit)
	if q < 0 {
		q = 0
	}
	return q, true
}

// ComputeProviderCostExpr 用「渠道×模型」成本表达式计算本次请求成本(quota 单位)。
// 与售价的分层计费完全对齐:同一套 billingexpr 引擎、同一份 TokenParams/RequestInput。
// 表达式系数是「每百万 token 的上游成本(¥,Rule 8 单币种)」;换算 quota 时【不乘分组倍率】。
//
// 回退链:
//  1. (channelId, model) / (global, model) 成本表达式 —— 命中即用;
//  2. 无表达式 -> 遗留扁平配置 ComputeProviderCost(按 scalar token);
//  3. 仍无配置 -> 返回 ok=false(调用方默认 成本=售价,毛利0)。
//
// scalar 参数(promptTokens 等)仅用于回退到遗留扁平配置时计算,表达式路径只用 params。
func ComputeProviderCostExpr(
	channelId int,
	modelName string,
	params billingexpr.TokenParams,
	request billingexpr.RequestInput,
	promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens int,
) (int, bool) {
	if exprStr, ok := provider_cost_setting.GetCostExpr(channelId, modelName); ok {
		cost, _, err := billingexpr.RunExprWithRequest(exprStr, params, request)
		if err != nil {
			common.SysError(fmt.Sprintf("provider cost expr run failed (channel=%d model=%s): %s", channelId, modelName, err.Error()))
		} else {
			// 与 v1 售价换算一致:表达式输出为 ¥/1M tokens,换算 quota 不乘分组倍率。
			q := billingexpr.QuotaRound(cost / 1_000_000.0 * common.QuotaPerUnit)
			if q < 0 {
				q = 0
			}
			return q, true
		}
	}
	// 回退:遗留扁平配置。
	return ComputeProviderCost(modelName, promptTokens, completionTokens, cacheReadTokens, cacheWriteTokens)
}

// otherInt 从 Other map 安全读取整数（值可能是 int / int64 / float64）。
func otherInt(m map[string]interface{}, key string) int {
	if m == nil {
		return 0
	}
	switch v := m[key].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	}
	return 0
}

// CostSummary 成本/毛利汇总。
type CostSummary struct {
	Days         int   `json:"days"`
	Requests     int64 `json:"requests"`
	Revenue      int64 `json:"revenue"`       // 售价合计(quota)
	ProviderCost int64 `json:"provider_cost"` // 上游成本合计(quota)
	Margin       int64 `json:"margin"`        // 毛利(quota)
}

// GetCostSummary 汇总最近 days 天的消费日志：售价、上游成本、毛利。
func GetCostSummary(days int) (CostSummary, error) {
	if days <= 0 {
		days = 7
	}
	since := common.GetTimestamp() - int64(days)*86400
	var s CostSummary
	s.Days = days
	row := LOG_DB.Model(&Log{}).
		Where("type = ? AND created_at >= ?", LogTypeConsume, since).
		Select("COUNT(*) as requests, COALESCE(SUM(quota),0) as revenue, COALESCE(SUM(provider_cost),0) as provider_cost")
	var result struct {
		Requests     int64
		Revenue      int64
		ProviderCost int64
	}
	if err := row.Scan(&result).Error; err != nil {
		return s, err
	}
	s.Requests = result.Requests
	s.Revenue = result.Revenue
	s.ProviderCost = result.ProviderCost
	s.Margin = result.Revenue - result.ProviderCost
	return s, nil
}

// CostBucket 是一个时间桶的营收/成本/毛利。
type CostBucket struct {
	BucketStart  int64 `json:"bucket_start"`  // 桶起始 unix 秒(桶左闭)
	Requests     int64 `json:"requests"`
	Revenue      int64 `json:"revenue"`       // 售价合计(quota)
	ProviderCost int64 `json:"provider_cost"` // 上游成本合计(quota)
	Margin       int64 `json:"margin"`        // 毛利(quota)
}

// CostTimeSeries 是一段时间范围内的成本汇总:总计 + 按 period 分桶的时间序列。
type CostTimeSeries struct {
	Period    string       `json:"period"`     // all/day/week/month/quarter/year
	Start     int64        `json:"start"`      // 实际生效的起始 unix 秒
	End       int64        `json:"end"`        // 实际生效的结束 unix 秒
	Requests  int64        `json:"requests"`
	Revenue   int64        `json:"revenue"`
	Provider  int64        `json:"provider_cost"`
	Margin    int64        `json:"margin"`
	Buckets   []CostBucket `json:"buckets"`
}

const secondsPerDay = 86400

// dayBucket 是按天分桶的中间结果(SQL 聚合直接产出)。
type dayBucket struct {
	Day          int64 // 当天 00:00(UTC 对齐到 86400 边界)的 unix 秒
	Requests     int64
	Revenue      int64
	ProviderCost int64
}

// GetCostTimeSeries 汇总 [start, end) 区间内消费日志的营收/成本/毛利,并按 period
// 分桶返回时间序列。
//   - period: all | day | week | month | quarter | year。all 表示不分桶(单一总桶)。
//   - start/end: unix 秒;end<=0 视为“现在”;start<=0 视为“不限起点”(全部时间)。
//
// 实现要点(三库兼容):SQL 层仅做“按天分桶”的整数运算(created_at - created_at%86400),
// 走 created_at 索引、不依赖任何数据库日期函数;周/月/季/年因长度不等,在 Go 里按
// 日历边界把天卷起来。毛利 = 营收 - 上游成本,沿用逐行相减语义。
func GetCostTimeSeries(period string, start, end int64) (CostTimeSeries, error) {
	ts := CostTimeSeries{Period: period}
	if end <= 0 {
		end = common.GetTimestamp()
	}
	if start < 0 {
		start = 0
	}
	ts.Start = start
	ts.End = end

	// 1) SQL:按天分桶聚合(整数运算,三库通用)。
	q := LOG_DB.Model(&Log{}).Where("type = ?", LogTypeConsume)
	if start > 0 {
		q = q.Where("created_at >= ?", start)
	}
	q = q.Where("created_at < ?", end)

	// day = created_at - (created_at % 86400):对齐到 UTC 自然日 00:00。
	dayExpr := fmt.Sprintf("(created_at - (created_at %% %d))", secondsPerDay)
	rows := q.
		Select(dayExpr + " as day, COUNT(*) as requests, COALESCE(SUM(quota),0) as revenue, COALESCE(SUM(provider_cost),0) as provider_cost").
		Group("day").
		Order("day asc")

	var days []dayBucket
	if err := rows.Scan(&days).Error; err != nil {
		return ts, err
	}

	// 2) 汇总总计。
	for _, d := range days {
		ts.Requests += d.Requests
		ts.Revenue += d.Revenue
		ts.Provider += d.ProviderCost
	}
	ts.Margin = ts.Revenue - ts.Provider

	// 3) 按 period 把天卷成时间桶。
	ts.Buckets = rollupDayBuckets(days, period)
	return ts, nil
}

// CostByDimension 是「按某维度(模型/渠道)」聚合的一行营收/成本/毛利。
type CostByDimension struct {
	Key          string `json:"key"`           // 维度键:模型名 或 渠道ID(字符串)
	Label        string `json:"label"`         // 展示名:模型名 或 渠道名
	Requests     int64  `json:"requests"`
	Revenue      int64  `json:"revenue"`       // 售价合计(quota)
	ProviderCost int64  `json:"provider_cost"` // 上游成本合计(quota)
	Margin       int64  `json:"margin"`        // 毛利(quota)
}

// costByDimension 是维度聚合的通用实现:SQL 层按 groupCol 分组求和,时间范围过滤,三库通用。
//   - groupCol: 分组列(model_name 或 channel_id),来自受控常量,非用户输入。
//   - start/end: unix 秒;end<=0 视为现在;start<=0 视为不限起点。
func costByDimension(groupCol string, start, end int64) ([]CostByDimension, error) {
	if end <= 0 {
		end = common.GetTimestamp()
	}
	if start < 0 {
		start = 0
	}
	q := LOG_DB.Model(&Log{}).Where("type = ?", LogTypeConsume)
	if start > 0 {
		q = q.Where("created_at >= ?", start)
	}
	q = q.Where("created_at < ?", end)

	type dimRow struct {
		GroupKey     string
		Requests     int64
		Revenue      int64
		ProviderCost int64
	}
	var rows []dimRow
	err := q.
		Select(groupCol + " as group_key, COUNT(*) as requests, COALESCE(SUM(quota),0) as revenue, COALESCE(SUM(provider_cost),0) as provider_cost").
		Group(groupCol).
		Order("revenue desc").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	out := make([]CostByDimension, 0, len(rows))
	for _, r := range rows {
		out = append(out, CostByDimension{
			Key:          r.GroupKey,
			Label:        r.GroupKey,
			Requests:     r.Requests,
			Revenue:      r.Revenue,
			ProviderCost: r.ProviderCost,
			Margin:       r.Revenue - r.ProviderCost,
		})
	}
	return out, nil
}

// GetCostByModel 按模型名聚合营收/成本/毛利。
func GetCostByModel(start, end int64) ([]CostByDimension, error) {
	return costByDimension("model_name", start, end)
}

// ModelGroupFallbackCol 是「模型组名,空则回落 model_name」的 SQL 聚合列,
// 与前端看板 `model_group || model_name` 的回落口径一致,避免直连/非组路由
// 流量全部塌进一个空桶。logs 与 quota_data 两表列名一致,可共用。
// CASE WHEN 在 SQLite/MySQL/PostgreSQL 三库通用。
const ModelGroupFallbackCol = "CASE WHEN model_group IS NULL OR model_group = '' THEN model_name ELSE model_group END"

// GetCostByModelGroup 按「路由命中的模型组」聚合营收/成本/毛利。
func GetCostByModelGroup(start, end int64) ([]CostByDimension, error) {
	return costByDimension(ModelGroupFallbackCol, start, end)
}

// GetCostByChannel 按渠道聚合营收/成本/毛利,并把渠道ID解析为渠道名。
func GetCostByChannel(start, end int64) ([]CostByDimension, error) {
	rows, err := costByDimension("channel_id", start, end)
	if err != nil {
		return nil, err
	}
	// 解析渠道名(批量查 channels 表;失败则退回显示渠道ID)。
	ids := make([]int, 0, len(rows))
	for _, r := range rows {
		if id, convErr := strconv.Atoi(r.Key); convErr == nil && id != 0 {
			ids = append(ids, id)
		}
	}
	if len(ids) > 0 {
		var channels []struct {
			Id   int
			Name string
		}
		if err := DB.Table("channels").Select("id, name").Where("id IN ?", ids).Find(&channels).Error; err == nil {
			nameById := make(map[int]string, len(channels))
			for _, ch := range channels {
				nameById[ch.Id] = ch.Name
			}
			for i := range rows {
				if id, convErr := strconv.Atoi(rows[i].Key); convErr == nil {
					if name, ok := nameById[id]; ok && name != "" {
						rows[i].Label = name
					}
				}
			}
		}
	}
	return rows, nil
}

// bucketKeyFn 把某天 00:00 的 unix 秒映射到其所属时间桶的起始 unix 秒。
func bucketStartFor(day int64, period string) int64 {
	if period == "day" {
		return day
	}
	t := time.Unix(day, 0).UTC()
	switch period {
	case "week":
		// ISO 周:回退到本周一 00:00。
		// Go 的 Weekday(): Sunday=0..Saturday=6;转成距周一的天数。
		offset := (int(t.Weekday()) + 6) % 7
		monday := t.AddDate(0, 0, -offset)
		return time.Date(monday.Year(), monday.Month(), monday.Day(), 0, 0, 0, 0, time.UTC).Unix()
	case "month":
		return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).Unix()
	case "quarter":
		// 季度首月:1/4/7/10。
		qMonth := time.Month((int(t.Month())-1)/3*3 + 1)
		return time.Date(t.Year(), qMonth, 1, 0, 0, 0, 0, time.UTC).Unix()
	case "year":
		return time.Date(t.Year(), 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	default: // day 已在上方处理;其余(含未知)按天兜底
		return day
	}
}

// rollupDayBuckets 把按天聚合的结果卷成指定 period 的时间桶。period=="all" 时返回单一总桶。
func rollupDayBuckets(days []dayBucket, period string) []CostBucket {
	if len(days) == 0 {
		return []CostBucket{}
	}
	if period == "all" || period == "" {
		var b CostBucket
		b.BucketStart = days[0].Day
		for _, d := range days {
			b.Requests += d.Requests
			b.Revenue += d.Revenue
			b.ProviderCost += d.ProviderCost
		}
		b.Margin = b.Revenue - b.ProviderCost
		return []CostBucket{b}
	}

	// days 已按 day asc,顺序追加即保持时间顺序。
	idx := make(map[int64]int)
	out := make([]CostBucket, 0)
	for _, d := range days {
		key := bucketStartFor(d.Day, period)
		i, ok := idx[key]
		if !ok {
			idx[key] = len(out)
			out = append(out, CostBucket{BucketStart: key})
			i = idx[key]
		}
		out[i].Requests += d.Requests
		out[i].Revenue += d.Revenue
		out[i].ProviderCost += d.ProviderCost
	}
	for i := range out {
		out[i].Margin = out[i].Revenue - out[i].ProviderCost
	}
	return out
}
