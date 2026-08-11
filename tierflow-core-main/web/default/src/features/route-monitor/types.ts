/*
Copyright (C) 2023-2026 TierFlow
*/
export interface RouteDecision {
  time: number
  request_id: string
  alias: string
  profile: string
  scored: boolean
  score: number
  tier: number
  model: string
  route_ms: number
  user_id: number
  token_name: string
}

export interface RouteMonitorResponse {
  success: boolean
  message?: string
  data?: RouteDecision[]
}

export interface RouteHealthEntry {
  scope: 'channel' | 'key'
  channel_id: number
  channel_name: string
  key_index: number
  state: 'closed' | 'open' | 'half_open'
  open_until: number
  recent_failures: number
  trip_count: number
}

export type ModelHealthState = 'healthy' | 'degraded' | 'down'

export interface ModelHealth {
  model: string
  total_channels: number
  available_channels: number
  cooling_channels: number
  state: ModelHealthState
  channels: ProviderHealth[]
}

export type ProviderHealthState =
  | 'healthy'
  | 'probing'
  | 'degraded'
  | 'cooling'

export interface ProviderHealth {
  channel_id: number
  channel_name: string
  channel_type: number
  provider_name: string
  state: ProviderHealthState
  is_multi_key: boolean
  total_keys: number
  cooling_keys: number
  models: number
  cooldown_left: number
}

export interface RouteHealthData {
  models: ModelHealth[]
  providers: ProviderHealth[]
  breakers: RouteHealthEntry[]
}

export interface RouteHealthResponse {
  success: boolean
  message?: string
  data?: RouteHealthData
}

// ModelChannelMetric is one channel's breaker health merged with its 24h
// performance metrics for the model detail page. Extends ProviderHealth.
export interface ModelChannelMetric extends ProviderHealth {
  avg_latency_ms: number
  avg_ttft_ms: number
  success_rate: number
  avg_tps: number
  request_count: number
  has_metrics: boolean
}

export interface ModelChannelMetricsData {
  model: string
  hours: number
  channels: ModelChannelMetric[]
}

export interface ModelChannelMetricsResponse {
  success: boolean
  message?: string
  data?: ModelChannelMetricsData
}
