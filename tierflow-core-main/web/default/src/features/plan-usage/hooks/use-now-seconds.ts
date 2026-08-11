/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useState } from 'react'

/**
 * 当前时间(unix 秒),按固定间隔刷新。
 *
 * 渲染期直接调 `Date.now()` 会被 react-hooks/purity 拦下(结果随重渲染漂移),
 * 剩余天数/今日用量这类跨零点会变的值必须走这里。首帧返回 0 —— 调用方据此
 * 判断「时间还没就绪」,别拿它当 1970 用。
 */
export function useNowSeconds(intervalMs = 60_000): number {
  const [now, setNow] = useState(0)

  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000))
    tick()
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
