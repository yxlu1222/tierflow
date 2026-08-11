package service

import "sync"

// RouteDecision —— 一次 auto 智能路由决策的快照（供实时路由监控）。
type RouteDecision struct {
	Time      int64   `json:"time"`       // unix 秒
	RequestId string  `json:"request_id"` // 请求 ID
	Alias     string  `json:"alias"`      // 用户请求的模型别名（如 auto）
	Profile   string  `json:"profile"`    // 命中的 profile slug
	Scored    bool    `json:"scored"`     // 是否由 infer 真实打分（false=兜底）
	Score     float64 `json:"score"`      // total_score_0_10
	Tier      int     `json:"tier"`       // 命中档位
	Model     string  `json:"model"`      // 解析出的具体模型
	RouteMs   int64   `json:"route_ms"`   // 路由决策耗时（毫秒，主要是 infer 打分往返）
	UserId    int     `json:"user_id"`
	TokenName string  `json:"token_name"`
	// 套餐额度门禁(仅套餐专用 Key 请求有值)
	Bucket  string `json:"bucket,omitempty"`  // premium / basic
	Degrade string `json:"degrade,omitempty"` // premium_exhausted / long_context
}

const routeMonitorCapacity = 500

var (
	routeMonitorMu     sync.RWMutex
	routeMonitorBuffer = make([]RouteDecision, 0, routeMonitorCapacity)
)

// RecordRouteDecision 追加一条路由决策到环形缓冲（超过容量丢弃最旧）。
func RecordRouteDecision(d RouteDecision) {
	routeMonitorMu.Lock()
	defer routeMonitorMu.Unlock()
	routeMonitorBuffer = append(routeMonitorBuffer, d)
	if len(routeMonitorBuffer) > routeMonitorCapacity {
		routeMonitorBuffer = routeMonitorBuffer[len(routeMonitorBuffer)-routeMonitorCapacity:]
	}
}

// GetRecentRouteDecisions 返回最近 limit 条决策（最新在前）。limit<=0 取全部。
func GetRecentRouteDecisions(limit int) []RouteDecision {
	routeMonitorMu.RLock()
	defer routeMonitorMu.RUnlock()
	n := len(routeMonitorBuffer)
	if limit <= 0 || limit > n {
		limit = n
	}
	out := make([]RouteDecision, 0, limit)
	for i := n - 1; i >= n-limit; i-- {
		out = append(out, routeMonitorBuffer[i])
	}
	return out
}
