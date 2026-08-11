/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'

// ============================================================================
// Redemption Schema & Types
// ============================================================================

export const redemptionSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  name: z.string(),
  key: z.string(),
  status: z.number(), // 1: enabled, 2: disabled, 3: used
  quota: z.number(),
  created_time: z.number(),
  redeemed_time: z.number(),
  expired_time: z.number(), // 0 for never expires
  used_user_id: z.number(),
  /** 0: 额度码（加钱包额度）, 1: 订阅码（开通套餐） */
  type: z.number().optional(),
  /** 仅订阅码有效，指向套餐 id */
  plan_id: z.number().optional(),
  /** 兑换人用户名，后端批量回填；用户已删除时为空 */
  used_username: z.string().optional(),
})

export type Redemption = z.infer<typeof redemptionSchema>

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface GetRedemptionsParams {
  p?: number
  page_size?: number
}

export interface GetRedemptionsResponse {
  success: boolean
  message?: string
  data?: {
    items: Redemption[]
    total: number
    page: number
    page_size: number
  }
}

export interface SearchRedemptionsParams {
  keyword?: string
  p?: number
  page_size?: number
}

export interface RedemptionFormData {
  id?: number
  name: string
  quota: number
  expired_time: number
  count?: number // Only for create
  status?: number // Only for status update
  type?: number // 0: quota code, 1: subscription code
  plan_id?: number // Only when type is subscription
}

// ============================================================================
// Dialog Types
// ============================================================================

export type RedemptionsDialogType = 'create' | 'update' | 'delete' | 'view'
