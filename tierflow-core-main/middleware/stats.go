package middleware

import (
	"sync/atomic"

	"github.com/Zer0Echo/tierflow-core/service"

	"github.com/gin-gonic/gin"
)

// HTTPStats 存储HTTP统计信息
type HTTPStats struct {
	activeConnections int64
}

var globalStats = &HTTPStats{}

// StatsMiddleware 统计中间件
func StatsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		// 增加活跃连接数
		atomic.AddInt64(&globalStats.activeConnections, 1)

		// 确保在请求结束时减少连接数
		defer func() {
			atomic.AddInt64(&globalStats.activeConnections, -1)
		}()

		c.Next()
	}
}

// StatsInfo 统计信息结构
type StatsInfo struct {
	ActiveConnections int64 `json:"active_connections"`
	// MessageCapture 消息记录管道的丢弃/失败计数。静默丢弃是最坏的失败模式 ——
	// 事后看数据只会觉得"这个用户不活跃"，所以必须暴露出来。
	MessageCapture service.MessageCaptureStats `json:"message_capture"`
}

// GetStats 获取统计信息
func GetStats() StatsInfo {
	return StatsInfo{
		ActiveConnections: atomic.LoadInt64(&globalStats.activeConnections),
		MessageCapture:    service.GetMessageCaptureStats(),
	}
}
