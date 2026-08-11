/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Type definitions for usage logs
 */
import type { UsageLog } from './data/schema'

// ============================================================================
// Log Category Types
// ============================================================================

/**
 * Log category for different log types
 */
export type LogCategory = 'common'

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Common filters (shared across all log types)
 */
export interface CommonFilters {
  startTime?: Date
  endTime?: Date
  channel?: string
}

/**
 * Common logs specific filters
 */
export interface CommonLogFilters extends CommonFilters {
  model?: string
  token?: string
  group?: string
  username?: string
  requestId?: string
  upstreamRequestId?: string
}

/**
 * Union type for all log filters
 */
export type LogFilters = CommonLogFilters

// ============================================================================
// Common Logs Additional Types
// ============================================================================

/**
 * Parsed data from the 'other' field in usage logs
 */
export interface ChannelAffinityInfo {
  rule_name?: string
  selected_group?: string
  key_source?: string
  key_path?: string
  key_key?: string
  key_hint?: string
  key_fp?: string
  using_group?: string
}

export interface LogOtherData {
  admin_info?: {
    is_multi_key?: boolean
    multi_key_index?: number
    use_channel?: number[]
    local_count_tokens?: boolean
    channel_affinity?: ChannelAffinityInfo
    // Top-up audit fields (type=1, admin only)
    payment_method?: string
    callback_payment_method?: string
    caller_ip?: string
    server_ip?: string
    version?: string
    node_name?: string
    // Manage audit fields (type=3, admin only)
    admin_username?: string
    admin_id?: number | string
  }
  request_path?: string
  request_conversion?: string[]
  ws?: boolean
  audio?: boolean
  audio_input?: number
  audio_output?: number
  text_input?: number
  text_output?: number
  cache_tokens?: number
  cache_creation_tokens?: number
  cache_creation_tokens_5m?: number
  cache_creation_tokens_1h?: number
  claude?: boolean
  model_ratio?: number
  completion_ratio?: number
  model_price?: number
  group_ratio?: number
  user_group_ratio?: number
  cache_ratio?: number
  cache_creation_ratio?: number
  cache_creation_ratio_5m?: number
  cache_creation_ratio_1h?: number
  is_model_mapped?: boolean
  upstream_model_name?: string
  // TierFlow 智能路由：用户调用的路由别名(模型广场模型)与改写后命中的真实上游模型。
  // model_name 展示为 "tierflow-" + auto_route_alias；auto_route_upstream 仅管理员可见。
  auto_route_alias?: string
  auto_route_upstream?: string
  auto_route_profile?: string
  // 路由命中的模型组(名快照 + id)、命中 tier、多模态短路与推理服务降级标记。
  // degraded/tier 仅管理员角标展示，不向普通用户暴露。
  auto_route_group?: string
  auto_route_group_id?: number
  auto_route_tier?: number
  auto_route_multimodal?: boolean
  auto_route_degraded?: boolean
  audio_ratio?: number
  audio_completion_ratio?: number
  frt?: number
  // Tiered (expression-based) billing fields, set by backend when
  // billing_mode === 'tiered_expr'. expr_b64 is the base64-encoded billing
  // expression and matched_tier is the label of the tier that fired.
  billing_mode?: string
  expr_b64?: string
  matched_tier?: string
  reasoning_effort?: string
  image?: boolean
  image_ratio?: number
  image_output?: number
  web_search?: boolean
  web_search_call_count?: number
  web_search_price?: number
  file_search?: boolean
  file_search_call_count?: number
  file_search_price?: number
  audio_input_seperate_price?: boolean
  audio_input_token_count?: number
  audio_input_price?: number
  image_generation_call?: boolean
  image_generation_call_price?: number
  is_system_prompt_overwritten?: boolean
  po?: string[]
  billing_source?: string
  group?: string
  stream_status?: {
    status?: string
    end_reason?: string
    error_count?: number
    end_error?: string
    errors?: string[]
  }
  // Violation fee fields
  violation_fee?: boolean
  violation_fee_code?: string
  violation_fee_marker?: string
  fee_quota?: number
  // Reject / intercept reason (admin)
  reject_reason?: string
  // Task-related fields (for refund logs, type=6)
  is_task?: boolean
  task_id?: string
  reason?: string
  // Subscription billing fields
  subscription_plan_id?: string
  subscription_plan_title?: string
  subscription_id?: string
  subscription_pre_consumed?: number
  subscription_post_delta?: number
  subscription_consumed?: number
  subscription_remain?: number
  subscription_total?: number
}

/**
 * Log statistics data
 */
export interface LogStatistics {
  quota: number
  rpm: number
  tpm: number
}

// ============================================================================
// Common Log Types
// ============================================================================

export interface GetLogsParams {
  p?: number
  page_size?: number
  type?: number
  username?: string
  token_name?: string
  strategy?: string
  start_timestamp?: number
  end_timestamp?: number
  channel?: number
  group?: string
  request_id?: string
  upstream_request_id?: string
}

export interface GetLogsResponse {
  success: boolean
  message?: string
  data?: {
    items: UsageLog[]
    total: number
    page: number
    page_size: number
  }
}

export interface GetLogStatsParams {
  type?: number
  username?: string
  token_name?: string
  strategy?: string
  start_timestamp?: number
  end_timestamp?: number
  channel?: number
  group?: string
  request_id?: string
  upstream_request_id?: string
}

export interface GetLogStatsResponse {
  success: boolean
  message?: string
  data?: LogStatistics
}

// ============================================================================
// Fetch Logs Configuration
// ============================================================================

/**
 * Configuration for fetching logs by category
 */
export interface FetchLogsConfig {
  logCategory: LogCategory
  isAdmin: boolean
  page: number
  pageSize: number
  searchParams: Record<string, unknown>
  columnFilters: Array<{ id: string; value: unknown }>
}

// ============================================================================
// User Info Types
// ============================================================================

export interface UserInfo {
  id: number
  username: string
  display_name?: string
  quota: number
  used_quota: number
  request_count: number
  group?: string
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  remark?: string
}
