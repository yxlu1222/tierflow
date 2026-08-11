package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Zer0Echo/tierflow-core/i18n"

	"github.com/gin-gonic/gin"
)

// 限流拒绝路径会走 i18n.T,未初始化 bundle 会 panic。
func init() {
	_ = i18n.Init()
}

// TestMemoryRateLimitTreatsZeroSuccessCountAsUnlimited
// successMaxCount==0 在 Redis 路径里明确表示「不限」(if successMaxCount > 0)。
// 内存路径若不加同样的判断,InMemoryRateLimiter.Request(key, 0, d) 首次建队列返回
// true、之后 len(queue) < 0 恒假,窗口内第二个请求起一律 429 —— 同一份配置在
// 开/关 Redis 两种部署下行为相反。
func TestMemoryRateLimitTreatsZeroSuccessCountAsUnlimited(t *testing.T) {
	gin.SetMode(gin.TestMode)

	handler := memoryRateLimitHandler(60, 0, 0)

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		c.Set("id", 4242)

		handler(c)

		if w.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d was rate limited despite successMaxCount=0 meaning unlimited", i+1)
		}
	}
}

// TestMemoryRateLimitStillEnforcesPositiveSuccessCount 确认上面的放行不是把限流整个关掉。
func TestMemoryRateLimitStillEnforcesPositiveSuccessCount(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const maxCount = 2
	handler := memoryRateLimitHandler(60, 0, maxCount)

	limited := false
	for i := 0; i < maxCount+3; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
		c.Set("id", 4343)

		handler(c)

		if w.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Errorf("successMaxCount=%d should eventually rate limit, but never did", maxCount)
	}
}
