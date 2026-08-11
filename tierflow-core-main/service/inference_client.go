package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/setting/system_setting"
)

// inferenceConfig 解析 infer 连接配置：优先取系统设置(可在后台改)，留空回退环境变量。
func inferenceConfig() (url, secret string, timeoutMs int) {
	s := system_setting.GetInferenceSettings()
	url = strings.TrimSpace(s.URL)
	if url == "" {
		url = common.GetEnvOrDefaultString("INFERENCE_SERVICE_URL", "")
	}
	secret = s.Secret
	if secret == "" {
		secret = common.GetEnvOrDefaultString("INFERENCE_SERVICE_SECRET", "")
	}
	timeoutMs = s.TimeoutMs
	if timeoutMs <= 0 {
		timeoutMs = common.GetEnvOrDefault("INFERENCE_SERVICE_TIMEOUT_MS", 10000)
	}
	return
}

// InferenceClient —— 调用 tierflow-infer 的 GPU 难度打分服务。
//
// 契约（tierflow-infer）：
//
//	POST {INFERENCE_SERVICE_URL}/internal/v1/classify
//	Header: X-Inference-Secret: <INFERENCE_SERVICE_SECRET>
//	Body:   {"messages": [...], "profile_id": "<slug>", "request_id": "..."}
//	Resp:   {"total_score_0_10": <float>, "scores_0_2": {...}, ...}
//
// 该服务无状态、与语言/DB 解耦，TierFlow 收敛到 new-api 后原样保留、不移植。

const (
	classifyPath   = "/internal/v1/classify"
	cbThreshold    = 3
	cbCooldownSecs = 30
)

type classifyPayload struct {
	Messages  []map[string]any `json:"messages"`
	ProfileId string           `json:"profile_id,omitempty"`
	RequestId string           `json:"request_id,omitempty"`
}

type classifyResponse struct {
	RequestId   string  `json:"request_id"`
	TotalScore  float64 `json:"total_score_0_10"`
	ScoreSource string  `json:"score_source"`
}

// 简单熔断器：连续失败到阈值后冷却一段时间内直接快速失败。
type inferenceBreaker struct {
	mu        sync.Mutex
	failures  int
	openUntil time.Time
}

var breaker = &inferenceBreaker{}

func (b *inferenceBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.failures >= cbThreshold && time.Now().Before(b.openUntil) {
		return false
	}
	return true
}

func (b *inferenceBreaker) recordSuccess() {
	b.mu.Lock()
	b.failures = 0
	b.mu.Unlock()
}

func (b *inferenceBreaker) recordFailure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.failures++
	if b.failures >= cbThreshold {
		b.openUntil = time.Now().Add(cbCooldownSecs * time.Second)
		common.SysError(fmt.Sprintf("inference service circuit breaker open (failures=%d, cooldown=%ds)", b.failures, cbCooldownSecs))
	}
}

// InferenceServiceConfigured 返回是否配置了 infer 服务地址。
func InferenceServiceConfigured() bool {
	url, _, _ := inferenceConfig()
	return url != ""
}

// ClassifyDifficulty 调用 tierflow-infer 对会话难度打分，返回 (总分0-10, 是否成功)。
// 失败（未配置/熔断/网络/非2xx/解析失败）一律返回 (0,false)，由调用方走兜底 tier。
func ClassifyDifficulty(messages []map[string]any, profileSlug string, requestId string) (float64, bool) {
	baseURL, secret, timeoutMs := inferenceConfig()
	if baseURL == "" {
		return 0, false
	}
	if len(messages) == 0 {
		return 0, false
	}
	if !breaker.allow() {
		return 0, false
	}

	payload := classifyPayload{
		Messages:  messages,
		ProfileId: profileSlug,
		RequestId: requestId,
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return 0, false
	}

	url := strings.TrimRight(baseURL, "/") + classifyPath
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return 0, false
	}
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("X-Inference-Secret", secret)
	}
	if requestId != "" {
		req.Header.Set("X-Request-Id", requestId)
	}

	client := &http.Client{Timeout: time.Duration(timeoutMs) * time.Millisecond}

	resp, err := client.Do(req)
	if err != nil {
		breaker.recordFailure()
		common.SysError("inference classify request failed: " + err.Error())
		return 0, false
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		breaker.recordFailure()
		return 0, false
	}

	if resp.StatusCode >= 400 {
		// 5xx 计入熔断；4xx 是客户端问题，不熔断
		if resp.StatusCode >= 500 {
			breaker.recordFailure()
		} else {
			breaker.recordSuccess()
		}
		common.SysError(fmt.Sprintf("inference classify returned %d: %s", resp.StatusCode, truncateForLog(respBody)))
		return 0, false
	}

	breaker.recordSuccess()
	var parsed classifyResponse
	if err := common.Unmarshal(respBody, &parsed); err != nil {
		common.SysError("inference classify decode failed: " + err.Error())
		return 0, false
	}
	return parsed.TotalScore, true
}

func truncateForLog(b []byte) string {
	const max = 256
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}
