-- 滑动窗口预留(原子):清过期条目 → 检上限 → 占位。
-- 供"成功请求数"限流用:请求前预留,失败后由调用方退还(RefundWindow),
-- 取代旧的 LLEN/LINDEX/LPUSH 分离操作——那在 2 RPM 这类极小配额下并发超发明显。
-- KEYS[1]: 窗口 key
-- ARGV[1]: 上限
-- ARGV[2]: 窗口秒数

local now = tonumber(redis.call('TIME')[1])
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

while true do
    local tail = redis.call('LINDEX', KEYS[1], -1)
    if not tail then break end
    if tonumber(tail) <= now - window then
        redis.call('RPOP', KEYS[1])
    else
        break
    end
end

if redis.call('LLEN', KEYS[1]) >= max then
    return 0
end

redis.call('LPUSH', KEYS[1], now)
redis.call('EXPIRE', KEYS[1], window + 60)
return 1
