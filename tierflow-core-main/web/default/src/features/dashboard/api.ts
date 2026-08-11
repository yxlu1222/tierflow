/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  CostDimensionRow,
  CostPeriod,
  CostSummary,
  CostTimeSeries,
  FinanceSummary,
  QuotaDataItem,
} from './types'

// ============================================================================
// Dashboard APIs
// ============================================================================

// ----------------------------------------------------------------------------
// Quota & Usage Data
// ----------------------------------------------------------------------------

// Get user quota data within a time range
// Admin users get all users' data by default (matching classic frontend behavior)
export async function getUserQuotaDates(
  params: {
    start_timestamp: number
    end_timestamp: number
    default_time?: string
    username?: string
    /** 口径过滤(仅 /api/data/self 支持):subscription=仅套餐,wallet=仅按量付费 */
    billing_source?: 'subscription' | 'wallet'
  },
  isAdmin = false
) {
  const endpoint = isAdmin ? '/api/data' : '/api/data/self'
  const res = await api.get<{ success: boolean; data: QuotaDataItem[] }>(
    endpoint,
    { params }
  )
  return res.data
}

// Admin-only: finance dashboard — paid recharge / consumption revenue / upstream
// cost / margin time series, interval totals, and the current global balance.
export async function getFinanceData(params: {
  start_timestamp: number
  end_timestamp: number
}) {
  const res = await api.get<{ success: boolean; data: FinanceSummary }>(
    '/api/data/finance',
    { params }
  )
  return res.data
}

// ----------------------------------------------------------------------------
// System Monitoring
// ----------------------------------------------------------------------------

export async function getUserQuotaDataByUsers(params: {
  start_timestamp: number
  end_timestamp: number
}) {
  const res = await api.get<{ success: boolean; data: QuotaDataItem[] }>(
    '/api/data/users',
    { params }
  )
  return res.data
}

// ----------------------------------------------------------------------------
// Revenue & Margin (admin-only, role >= ROLE.ADMIN via backend AdminAuth)
// ----------------------------------------------------------------------------

// Aggregate revenue / provider cost / margin for the last N days.
export async function getCostSummary(days = 7) {
  const res = await api.get<{ success: boolean; data: CostSummary }>(
    `/api/route_monitor/cost_summary?days=${days}`,
    { disableDuplicate: true }
  )
  return res.data
}

// Revenue / cost / margin bucketed over time. `start`/`end` are unix seconds
// (omit for the backend's full-range default).
export async function getCostTimeSeries(params: {
  period: CostPeriod
  start?: number
  end?: number
}) {
  const search = new URLSearchParams({ period: params.period })
  if (params.start != null) search.set('start', String(params.start))
  if (params.end != null) search.set('end', String(params.end))
  const res = await api.get<{ success: boolean; data: CostTimeSeries }>(
    `/api/route_monitor/cost_time_series?${search.toString()}`,
    { disableDuplicate: true }
  )
  return res.data
}

// Revenue / cost / margin grouped by model, sorted by revenue desc (backend).
// dimension: 'group'(默认，按路由命中的模型组；直连流量回落模型名) | 'model'(按真实模型)。
export async function getCostByModel(params?: {
  start?: number
  end?: number
  dimension?: 'group' | 'model'
}) {
  const search = new URLSearchParams()
  if (params?.start != null) search.set('start', String(params.start))
  if (params?.end != null) search.set('end', String(params.end))
  if (params?.dimension) search.set('dimension', params.dimension)
  const qs = search.toString()
  const res = await api.get<{ success: boolean; data: CostDimensionRow[] }>(
    `/api/route_monitor/cost_by_model${qs ? `?${qs}` : ''}`,
    { disableDuplicate: true }
  )
  return res.data
}

// Revenue / cost / margin grouped by channel, sorted by revenue desc (backend).
export async function getCostByChannel(params?: {
  start?: number
  end?: number
}) {
  const search = new URLSearchParams()
  if (params?.start != null) search.set('start', String(params.start))
  if (params?.end != null) search.set('end', String(params.end))
  const qs = search.toString()
  const res = await api.get<{ success: boolean; data: CostDimensionRow[] }>(
    `/api/route_monitor/cost_by_channel${qs ? `?${qs}` : ''}`,
    { disableDuplicate: true }
  )
  return res.data
}
