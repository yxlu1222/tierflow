package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/common/limiter"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/i18n"
	"github.com/Zer0Echo/tierflow-core/setting"

	"github.com/gin-gonic/gin"
)

const (
	ModelRequestRateLimitCountMark        = "MRRL"
	ModelRequestRateLimitSuccessCountMark = "MRRLS"
)

// setRetryAfter 提示客户端(Claude Code / Codex 等)退避重试的等待秒数。
// 2 RPM 这类紧限速下没有它,客户端只会盲目立即重试。
func setRetryAfter(c *gin.Context, seconds int64) {
	c.Header("Retry-After", strconv.FormatInt(seconds, 10))
}

// Redis限流处理器
func redisRateLimitHandler(duration int64, totalMaxCount, successMaxCount int) gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		ctx := context.Background()
		rdb := common.RDB
		tb := limiter.New(ctx, rdb)

		// 1. 成功请求数:滑动窗口原子预留(请求失败在响应后退还)。
		// 取代旧的 LLEN/LINDEX/LPUSH 分离读写——极小配额(如 2 RPM)下并发超发明显,
		// 且旧实现在 c.Next() 之后才记账,长流式请求期间不占配额。
		reserved := false
		successKey := fmt.Sprintf("rateLimit:%s:%s", ModelRequestRateLimitSuccessCountMark, userId)
		if successMaxCount > 0 {
			ok, err := tb.ReserveWindow(ctx, successKey, successMaxCount, duration)
			if err != nil {
				fmt.Println("检查成功请求数限制失败:", err.Error())
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}
			if !ok {
				setRetryAfter(c, duration)
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": successMaxCount}))
				return
			}
			reserved = true
		}

		//2.检查总请求数限制并记录总请求（当totalMaxCount为0时会自动跳过，使用令牌桶限流器
		if totalMaxCount > 0 {
			totalKey := fmt.Sprintf("rateLimit:%s", userId)
			allowed, err := tb.Allow(
				ctx,
				totalKey,
				limiter.WithCapacity(int64(totalMaxCount)*duration),
				limiter.WithRate(int64(totalMaxCount)),
				limiter.WithRequested(duration),
			)

			if err != nil {
				fmt.Println("检查总请求数限制失败:", err.Error())
				if reserved {
					tb.RefundWindow(ctx, successKey)
				}
				abortWithOpenAiMessage(c, http.StatusInternalServerError, "rate_limit_check_failed")
				return
			}

			if !allowed {
				if reserved {
					tb.RefundWindow(ctx, successKey)
				}
				setRetryAfter(c, duration)
				abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitTotalReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": totalMaxCount}))
				return
			}
		}

		// 3. 处理请求
		c.Next()

		// 4. 请求失败退还成功数占位
		if reserved && c.Writer.Status() >= 400 {
			tb.RefundWindow(ctx, successKey)
		}
	}
}

// 内存限流处理器
func memoryRateLimitHandler(duration int64, totalMaxCount, successMaxCount int) gin.HandlerFunc {
	inMemoryRateLimiter.Init(time.Duration(setting.ModelRequestRateLimitDurationMinutes) * time.Minute)

	return func(c *gin.Context) {
		userId := strconv.Itoa(c.GetInt("id"))
		totalKey := ModelRequestRateLimitCountMark + userId
		successKey := ModelRequestRateLimitSuccessCountMark + userId

		// 1. 检查总请求数限制（当totalMaxCount为0时跳过）
		if totalMaxCount > 0 && !inMemoryRateLimiter.Request(totalKey, totalMaxCount, duration) {
			setRetryAfter(c, duration)
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitTotalReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": totalMaxCount}))
			return
		}

		// 2. 检查成功请求数限制（当successMaxCount为0时跳过，与 Redis 路径语义一致：0=不限）
		// 使用一个临时key来检查限制，这样可以避免实际记录
		// 注意必须判 >0：InMemoryRateLimiter.Request(key, 0, d) 首次调用会建队列返回 true，
		// 之后 len(queue) < 0 恒假，窗口内第二个请求起一律 429。
		checkKey := successKey + "_check"
		if successMaxCount > 0 && !inMemoryRateLimiter.Request(checkKey, successMaxCount, duration) {
			setRetryAfter(c, duration)
			abortWithOpenAiMessage(c, http.StatusTooManyRequests, i18n.T(c, i18n.MsgRateLimitReached, map[string]any{"Minutes": setting.ModelRequestRateLimitDurationMinutes, "Max": successMaxCount}))
			return
		}

		// 3. 处理请求
		c.Next()

		// 4. 如果请求成功，记录到实际的成功请求计数中
		if successMaxCount > 0 && c.Writer.Status() < 400 {
			inMemoryRateLimiter.Request(successKey, successMaxCount, duration)
		}
	}
}

// ModelRequestRateLimit 模型请求限流中间件
func ModelRequestRateLimit() func(c *gin.Context) {
	return func(c *gin.Context) {
		// 在每个请求时检查是否启用限流
		if !setting.ModelRequestRateLimitEnabled {
			c.Next()
			return
		}

		// 计算限流参数
		duration := int64(setting.ModelRequestRateLimitDurationMinutes * 60)
		totalMaxCount := setting.ModelRequestRateLimitCount
		successMaxCount := setting.ModelRequestRateLimitSuccessCount

		// 获取分组
		group := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
		if group == "" {
			group = common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		}

		//获取分组的限流配置
		groupTotalCount, groupSuccessCount, found := setting.GetGroupRateLimit(group)
		if found {
			totalMaxCount = groupTotalCount
			successMaxCount = groupSuccessCount
		}

		// 根据存储类型选择并执行限流处理器
		if common.RedisEnabled {
			redisRateLimitHandler(duration, totalMaxCount, successMaxCount)(c)
		} else {
			memoryRateLimitHandler(duration, totalMaxCount, successMaxCount)(c)
		}
	}
}
