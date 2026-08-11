package controller

import (
	"strconv"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	perfmetrics "github.com/Zer0Echo/tierflow-core/pkg/perf_metrics"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"
	"github.com/Zer0Echo/tierflow-core/service"

	"github.com/gin-gonic/gin"
)

// GetRouteMonitor 返回最近的 auto 智能路由决策（实时路由监控）。
func GetRouteMonitor(c *gin.Context) {
	limit := 200
	if v := c.Query("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	common.ApiSuccess(c, service.GetRecentRouteDecisions(limit))
}

// routeHealthEntry is a breaker snapshot entry enriched with the channel name.
type routeHealthEntry struct {
	routehealth.SnapshotEntry
	ChannelName string `json:"channel_name"`
}

// GetRouteHealth 返回高可用路由的实时健康视图：模型健康、服务商（渠道）健康，
// 以及底层熔断器逐条快照（诊断用）。
func GetRouteHealth(c *gin.Context) {
	models, providers := model.BuildRouteHealth()

	// Raw per-entry breaker snapshot (only entries that have tripped/failed),
	// enriched with channel names — kept for diagnostics.
	snapshot := routehealth.Snapshot()
	nameCache := make(map[int]string)
	breakers := make([]routeHealthEntry, 0, len(snapshot))
	for _, e := range snapshot {
		name, ok := nameCache[e.ChannelId]
		if !ok {
			if ch, err := model.CacheGetChannel(e.ChannelId); err == nil && ch != nil {
				name = ch.Name
			}
			nameCache[e.ChannelId] = name
		}
		breakers = append(breakers, routeHealthEntry{SnapshotEntry: e, ChannelName: name})
	}

	common.ApiSuccess(c, gin.H{
		"models":    models,
		"providers": providers,
		"breakers":  breakers,
	})
}

// modelChannelMetric merges a channel's breaker health with its performance
// metrics (latency / TTFT / TPS / success rate) for the model detail view.
type modelChannelMetric struct {
	model.ProviderHealth
	AvgLatencyMs int64   `json:"avg_latency_ms"`
	AvgTtftMs    int64   `json:"avg_ttft_ms"`
	SuccessRate  float64 `json:"success_rate"`
	AvgTps       float64 `json:"avg_tps"`
	RequestCount int64   `json:"request_count"`
	HasMetrics   bool    `json:"has_metrics"` // false => no traffic in the window
}

// GetModelChannelMetrics 返回某模型下每条渠道的实时健康 + 近 24h 性能指标
// (延迟 / 首字延迟 / 吞吐 / 成功率),供模型详情页使用。
func GetModelChannelMetrics(c *gin.Context) {
	modelName := c.Query("model")
	if modelName == "" {
		common.ApiErrorMsg(c, "missing model")
		return
	}
	hours := 24
	if v := c.Query("hours"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			hours = n
		}
	}

	health := model.BuildModelChannelHealth(modelName)

	perf, err := perfmetrics.QueryChannelSummary(modelName, hours)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	perfByChannel := make(map[int]perfmetrics.ChannelSummary, len(perf.Channels))
	for _, ch := range perf.Channels {
		perfByChannel[ch.ChannelId] = ch
	}

	metrics := make([]modelChannelMetric, 0, len(health))
	for _, h := range health {
		m := modelChannelMetric{ProviderHealth: h}
		if p, ok := perfByChannel[h.ChannelId]; ok {
			m.AvgLatencyMs = p.AvgLatencyMs
			m.AvgTtftMs = p.AvgTtftMs
			m.SuccessRate = p.SuccessRate
			m.AvgTps = p.AvgTps
			m.RequestCount = p.RequestCount
			m.HasMetrics = p.RequestCount > 0
		}
		metrics = append(metrics, m)
	}

	common.ApiSuccess(c, gin.H{
		"model":    modelName,
		"hours":    hours,
		"channels": metrics,
	})
}

// GetCostSummary 返回最近 N 天的售价/上游成本/毛利汇总。
func GetCostSummary(c *gin.Context) {
	days := 7
	if v := c.Query("days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			days = n
		}
	}
	summary, err := model.GetCostSummary(days)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, summary)
}

// validCostPeriods 是营收看板支持的分桶粒度。
var validCostPeriods = map[string]bool{
	"all":     true,
	"day":     true,
	"week":    true,
	"month":   true,
	"quarter": true,
	"year":    true,
}

// GetCostTimeSeries 返回营收/上游成本/毛利的汇总与按 period 分桶的时间序列。
// 查询参数:
//   - period: all|day|week|month|quarter|year(默认 day)
//   - start:  起始 unix 秒(可选;缺省/<=0 表示全部时间的起点)
//   - end:    结束 unix 秒(可选;缺省表示现在)
//
// 管理员可访问(营收看板迁入管理员数据看板,路由上用组内 AdminAuth 守卫)。
func GetCostTimeSeries(c *gin.Context) {
	period := c.Query("period")
	if period == "" {
		period = "day"
	}
	if !validCostPeriods[period] {
		common.ApiErrorMsg(c, "invalid period")
		return
	}

	start, end := parseCostRange(c)

	series, err := model.GetCostTimeSeries(period, start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, series)
}

// parseCostRange 解析 start/end 查询参数(unix 秒),用于维度化成本接口。
func parseCostRange(c *gin.Context) (start, end int64) {
	if v := c.Query("start"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			start = n
		}
	}
	if v := c.Query("end"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			end = n
		}
	}
	return start, end
}

// GetCostByModel 返回按模型维度聚合的营收/上游成本/毛利。
// query dimension=group(默认)|model。模型组=同一模型跨上游的高可用聚类(组名即
// 规范模型名)，故 group 视图就是按模型看成本；model 视图按 logs.model_name 聚合，
// 路由流量的 model_name 为方案别名——其真实语义是"按方案"(直连流量回落模型名)。
func GetCostByModel(c *gin.Context) {
	start, end := parseCostRange(c)
	var (
		rows []model.CostByDimension
		err  error
	)
	if c.DefaultQuery("dimension", "group") == "model" {
		rows, err = model.GetCostByModel(start, end)
	} else {
		rows, err = model.GetCostByModelGroup(start, end)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}

// GetCostByChannel 返回按渠道聚合的营收/上游成本/毛利(含渠道名)。
func GetCostByChannel(c *gin.Context) {
	start, end := parseCostRange(c)
	rows, err := model.GetCostByChannel(start, end)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rows)
}
