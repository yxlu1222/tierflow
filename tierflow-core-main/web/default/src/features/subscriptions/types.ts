/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'

// ============================================================================
// Subscription Plan Schema & Types
// ============================================================================

export const subscriptionPlanSchema = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().optional(),
  // 售价(人民币,全站唯一货币)
  price_amount: z.number(),
  // 基础模型桶(token 数):-1=无限,0=无,正数=总量
  basic_token_total: z.number().optional().default(0),
  // 双桶各自引用的套餐模型组(0=未配置)
  premium_set_id: z.number().optional().default(0),
  basic_set_id: z.number().optional().default(0),
  duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
  duration_value: z.number(),
  custom_seconds: z.number().optional(),
  quota_reset_period: z.enum(['never', 'daily', 'weekly', 'monthly', 'custom']),
  quota_reset_custom_seconds: z.number().optional(),
  enabled: z.boolean(),
  sort_order: z.number(),
  // 推荐标记:套餐页/充值页高亮展示该档
  recommended: z.boolean().optional().default(false),
  allow_balance_pay: z.boolean().optional().default(true),
  max_purchase_per_user: z.number(),
  total_amount: z.number(),
  upgrade_group: z.string().optional(),
})

export type SubscriptionPlan = z.infer<typeof subscriptionPlanSchema>

export interface PlanRecord {
  plan: SubscriptionPlan
}

// ============================================================================
// User Subscription Schema & Types
// ============================================================================

export const userSubscriptionSchema = z.object({
  id: z.number(),
  /** 仅管理端返回;用户侧 /api/subscription/self 不下发 */
  user_id: z.number().optional(),
  plan_id: z.number(),
  status: z.string(),
  source: z.string().optional(),
  start_time: z.number(),
  end_time: z.number(),
  amount_total: z.number(),
  amount_used: z.number(),
  // 基础模型桶(token 数;-1=无限,0=无)与售价快照
  basic_token_total: z.number().optional().default(0),
  basic_token_used: z.number().optional().default(0),
  paid_money: z.number().optional().default(0),
  next_reset_time: z.number().optional(),
  /**
   * 后端按 plan_id 直查回填的套餐名(不受套餐 enabled 影响)。
   * 展示套餐名一律优先用它 —— 客户端 join 在售列表取不到已停用套餐,
   * 会让存量未过期订阅丢掉名字。套餐被硬删时为空。
   */
  plan_title: z.string().optional(),
})

export type UserSubscription = z.infer<typeof userSubscriptionSchema>

export interface UserSubscriptionRecord {
  subscription: UserSubscription
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PlanPayload {
  plan: Partial<SubscriptionPlan>
}

export interface SubscriptionPayRequest {
  plan_id: number
  payment_method?: string
}

export interface SubscriptionPayResponse {
  success: boolean
  message?: string
  data?: Record<string, unknown>
  url?: string
}

export interface CreateUserSubscriptionRequest {
  plan_id: number
}

// ============================================================================
// Self Subscription Data (user-facing)
// ============================================================================

export interface SelfSubscriptionData {
  subscriptions: UserSubscriptionRecord[]
  all_subscriptions: UserSubscriptionRecord[]
}

// ============================================================================
// Dialog Types
// ============================================================================

export type SubscriptionsDialogType =
  | 'create'
  | 'update'
  | 'toggle-status'
  | 'delete'
