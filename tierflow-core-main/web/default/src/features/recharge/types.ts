/*
Copyright (C) 2023-2026 TierFlow
*/
// ============================================================================
// Wallet Type Definitions
// ============================================================================

/**
 * Generic API response
 */
export interface ApiResponse<T = unknown> {
  success?: boolean
  message?: string
  data?: T
}

/**
 * Standard API response types
 */
export type TopupInfoResponse = ApiResponse<TopupInfo>

/**
 * 兑换结果。type 决定哪些字段有意义：
 * 额度码只填 quota；订阅码填 plan_title / end_time / sub_id。
 * 与后端 model.RedeemResult 对应。
 */
export interface RedeemResult {
  /** 0: 额度码, 1: 订阅码 */
  type: number
  quota: number
  plan_title?: string
  end_time?: number
  sub_id?: number
  /** 订阅码：开通时自动签发的套餐专用 Key（不含 sk- 前缀） */
  token_key?: string
}

export type RedemptionResponse = ApiResponse<RedeemResult>
export type AmountResponse = ApiResponse<string>
export type PaymentResponse = ApiResponse<Record<string, unknown>> & {
  url?: string
}
export type AffiliateCodeResponse = ApiResponse<string>
export type AffiliateTransferResponse = ApiResponse

/**
 * Payment method configuration
 */
export interface PaymentMethod {
  /** Display name of payment method */
  name: string
  /** Payment method type identifier */
  type: string
  /** Optional color for UI display */
  color?: string
  /** Minimum topup amount for this payment method */
  min_topup?: number
  /** Optional icon URL provided by backend (preferred over built-in icons) */
  icon?: string
}

/**
 * Topup configuration information
 */
export interface TopupInfo {
  /** Whether online topup is enabled */
  enable_online_topup: boolean
  /** Available payment methods */
  pay_methods: PaymentMethod[]
  /** Minimum topup amount for online topup */
  min_topup: number
  /** Preset amount options */
  amount_options: number[]
  /** Discount rates by amount */
  discount: Record<number, number>
  /** Optional topup link for purchasing codes */
  topup_link?: string
  /** Whether redemption code usage is enabled */
  enable_redemption?: boolean
  /** Whether the invitation/referral reward feature is enabled */
  enable_invitation_reward?: boolean
  /** Whether compliance confirmation has been completed */
  payment_compliance_confirmed?: boolean
  /** Current compliance terms version */
  payment_compliance_terms_version?: string
}

/**
 * Preset amount option with optional discount
 */
export interface PresetAmount {
  /** Preset amount value */
  value: number
  /** Optional discount rate (0-1) */
  discount?: number
}

/**
 * Redemption code request
 */
export interface RedemptionRequest {
  /** Redemption code key */
  key: string
}

/**
 * Payment request parameters
 */
export interface PaymentRequest {
  /** Topup amount */
  amount: number
  /** Payment method identifier */
  payment_method: string
}

/**
 * Amount calculation request
 */
export interface AmountRequest {
  /** Topup amount to calculate */
  amount: number
}

/**
 * Affiliate quota transfer request
 */
export interface AffiliateTransferRequest {
  /** Quota amount to transfer */
  quota: number
}

/**
 * User wallet data
 */
export interface UserWalletData {
  /** User ID */
  id: number
  /** Username */
  username: string
  /** Current quota balance */
  quota: number
  /** Total used quota */
  used_quota: number
  /** Total request count */
  request_count: number
  /** Affiliate quota (pending rewards) */
  aff_quota: number
  /** Total affiliate quota earned (historical) */
  aff_history_quota: number
  /** Number of successful affiliate invites */
  aff_count: number
  /** User group */
  group: string
}

/**
 * Topup record status
 */
// 与后端 common.TopUpStatus* 一一对应。failed / refunded 由管理端的关单与
// 标记退款动作写入,漏掉会让这些订单在用户账单页兜底显示成「待支付」。
export type TopupStatus =
  | 'success'
  | 'pending'
  | 'expired'
  | 'failed'
  | 'refunded'

/**
 * Topup billing record
 */
export interface TopupRecord {
  /** Record ID */
  id: number
  /** 仅管理端返回;用户侧 /api/user/topup/self 不下发 */
  user_id?: number
  /** Topup amount (quota) */
  amount: number
  /** Payment amount (actual money paid) */
  money: number
  /** Trade/order number */
  trade_no: string
  /** Payment method type */
  payment_method: string
  /** Creation timestamp */
  create_time: number
  /** Completion timestamp */
  complete_time?: number
  /** Payment status */
  status: TopupStatus
}

/**
 * Billing history response
 */
export interface BillingHistoryResponse {
  items: TopupRecord[]
  total: number
}
