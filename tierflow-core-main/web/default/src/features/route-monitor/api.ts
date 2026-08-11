/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  ModelChannelMetricsResponse,
  RouteHealthResponse,
  RouteMonitorResponse,
} from './types'

export async function getRouteMonitor(
  limit = 200
): Promise<RouteMonitorResponse> {
  const res = await api.get(`/api/route_monitor/?limit=${limit}`, {
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return res.data
}

export async function getRouteHealth(): Promise<RouteHealthResponse> {
  const res = await api.get(`/api/route_monitor/health`, {
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return res.data
}

export async function getModelChannelMetrics(
  model: string,
  hours = 24
): Promise<ModelChannelMetricsResponse> {
  const res = await api.get(
    `/api/route_monitor/model_metrics?model=${encodeURIComponent(model)}&hours=${hours}`,
    {
      disableDuplicate: true,
      skipErrorHandler: true,
    }
  )
  return res.data
}
