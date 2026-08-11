/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { calculateDashboardStats } from '@/features/dashboard/lib'

export interface UserQuotaTimeRange {
  /** Unix seconds. */
  start_timestamp: number
  /** Unix seconds. */
  end_timestamp: number
}

/**
 * `/api/data/self` 用量行的**唯一** query 定义 —— KPI 卡与模型调用分布环图都用它。
 *
 * 共用一份定义 = 共用一个 react-query 缓存键:两者的时间窗相同时(默认都是近 7 天)
 * 只会发**一次**请求。此前两边各自 useQuery、键还不一样,同一份数据每次进页面要拉
 * 两遍,而 quota_data 全表扫是这一页最慢的查询。
 *
 * 刻意不带 `default_time`:controller/usedata.go 的 GetUserQuotaDates 只读
 * start_timestamp / end_timestamp / billing_source,`default_time` 从来没被服务端
 * 消费过 —— 把它塞进参数只会让两边的键分叉、退回两次请求。
 *
 * 口径固定 wallet(按量付费);套餐扣费在 /subscription 页单独拆桶展示,两页互补。
 */
export function userQuotaRowsQuery(timeRange: UserQuotaTimeRange) {
  return {
    queryKey: ['dashboard', 'user-quota-rows', timeRange] as const,
    queryFn: () =>
      getUserQuotaDates(
        { ...timeRange, billing_source: 'wallet' as const },
        false
      ),
    staleTime: 60 * 1000,
  }
}

export interface OverviewData {
  totals: { totalQuota: number; totalCount: number; totalTokens: number }
  /**
   * Spend change vs. the immediately preceding window of equal length, in
   * percent (positive = up). `null` when there is no prior-period baseline.
   */
  spendDeltaPct: number | null
  loading: boolean
  isError: boolean
}

/**
 * 用量信息页 KPI 的取数:拉当前用户在给定区间的用量,只暴露三个合计值和与上一
 * 等长区间的消费环比。
 *
 * 这里刻意不返回原始行、时间序列或 refetch —— 首屏的趋势图和卡内迷你折线已经
 * 移除,明细由页面下方的活动日志表自己取数,模型调用分布环图有自己的时间窗、也
 * 自己取数。多返回一份没人消费的数据,只会让下一个改这里的人以为它还有用。
 */
export function useOverviewData(params: {
  /** Unix seconds. */
  startTimestamp: number
  /** Unix seconds. */
  endTimestamp: number
}): OverviewData {
  const { startTimestamp, endTimestamp } = params

  const timeRange = useMemo(
    () => ({ start_timestamp: startTimestamp, end_timestamp: endTimestamp }),
    [startTimestamp, endTimestamp]
  )

  // The window immediately preceding `timeRange`, of equal length — used only
  // to compute the spend delta shown on the KPI strip. Same endpoint (existing
  // user endpoint), so this stays a pure frontend addition.
  const prevTimeRange = useMemo(() => {
    const windowSec = timeRange.end_timestamp - timeRange.start_timestamp
    return {
      start_timestamp: timeRange.start_timestamp - windowSec,
      end_timestamp: timeRange.start_timestamp,
    }
  }, [timeRange])

  // 两个窗口都走同一个 query 定义(见 userQuotaRowsQuery):键只由时间窗决定,
  // 所以模型调用分布环图选中相同窗口时与这里共享同一份缓存、不重复请求。
  const query = useQuery(userQuotaRowsQuery(timeRange))
  const prevQuery = useQuery(userQuotaRowsQuery(prevTimeRange))

  const data = useMemo(() => query.data?.data ?? [], [query.data])
  const totals = useMemo(() => calculateDashboardStats(data), [data])

  const spendDeltaPct = useMemo(() => {
    const prevQuota = calculateDashboardStats(
      prevQuery.data?.data ?? []
    ).totalQuota
    if (!prevQuery.data || prevQuota <= 0) return null
    return ((totals.totalQuota - prevQuota) / prevQuota) * 100
  }, [prevQuery.data, totals.totalQuota])

  return {
    totals,
    spendDeltaPct,
    loading: query.isLoading,
    isError: query.isError,
  }
}
