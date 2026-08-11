package limiter

import (
	"context"
	_ "embed"
	"fmt"
	"strings"
	"sync"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/go-redis/redis/v8"
)

//go:embed lua/rate_limit.lua
var rateLimitScript string

//go:embed lua/reserve_window.lua
var reserveWindowScript string

type RedisLimiter struct {
	client           *redis.Client
	limitScriptSHA   string
	reserveScriptSHA string
}

var (
	instance *RedisLimiter
	once     sync.Once
)

func New(ctx context.Context, r *redis.Client) *RedisLimiter {
	once.Do(func() {
		// 预加载脚本
		limitSHA, err := r.ScriptLoad(ctx, rateLimitScript).Result()
		if err != nil {
			common.SysLog(fmt.Sprintf("Failed to load rate limit script: %v", err))
		}
		reserveSHA, err := r.ScriptLoad(ctx, reserveWindowScript).Result()
		if err != nil {
			common.SysLog(fmt.Sprintf("Failed to load reserve window script: %v", err))
		}
		instance = &RedisLimiter{
			client:           r,
			limitScriptSHA:   limitSHA,
			reserveScriptSHA: reserveSHA,
		}
	})

	return instance
}

// evalScript 优先 EvalSha,Redis 重启丢失脚本缓存(NOSCRIPT)时回退 Eval
// 并重新加载——否则 sync.Once 缓存的 SHA 会永久失败。
func (rl *RedisLimiter) evalScript(ctx context.Context, sha, script string, keys []string, args ...interface{}) (int, error) {
	result, err := rl.client.EvalSha(ctx, sha, keys, args...).Int()
	if err != nil && strings.Contains(err.Error(), "NOSCRIPT") {
		result, err = rl.client.Eval(ctx, script, keys, args...).Int()
	}
	return result, err
}

func (rl *RedisLimiter) Allow(ctx context.Context, key string, opts ...Option) (bool, error) {
	// 默认配置
	config := &Config{
		Capacity:  10,
		Rate:      1,
		Requested: 1,
	}

	// 应用选项模式
	for _, opt := range opts {
		opt(config)
	}

	// 执行限流
	result, err := rl.evalScript(
		ctx,
		rl.limitScriptSHA,
		rateLimitScript,
		[]string{key},
		config.Requested,
		config.Rate,
		config.Capacity,
	)

	if err != nil {
		return false, fmt.Errorf("rate limit failed: %w", err)
	}
	return result == 1, nil
}

// ReserveWindow 在滑动窗口内原子占位:未超上限则记一条并返回 true。
// 请求失败时调用方应 RefundWindow 退还,避免失败请求占用成功数配额。
func (rl *RedisLimiter) ReserveWindow(ctx context.Context, key string, max int, windowSeconds int64) (bool, error) {
	if max <= 0 {
		return true, nil
	}
	result, err := rl.evalScript(ctx, rl.reserveScriptSHA, reserveWindowScript,
		[]string{key}, max, windowSeconds)
	if err != nil {
		return false, fmt.Errorf("reserve window failed: %w", err)
	}
	return result == 1, nil
}

// RefundWindow 退还一次占位(移除最新条目;并发下移除任意一条在计数意义上等价)。
func (rl *RedisLimiter) RefundWindow(ctx context.Context, key string) {
	_ = rl.client.LPop(ctx, key).Err()
}

// Config 配置选项模式
type Config struct {
	Capacity  int64
	Rate      int64
	Requested int64
}

type Option func(*Config)

func WithCapacity(c int64) Option {
	return func(cfg *Config) { cfg.Capacity = c }
}

func WithRate(r int64) Option {
	return func(cfg *Config) { cfg.Rate = r }
}

func WithRequested(n int64) Option {
	return func(cfg *Config) { cfg.Requested = n }
}
