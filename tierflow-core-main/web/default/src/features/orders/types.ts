/*
Copyright (C) 2023-2026 TierFlow
*/

// ============================================================================
// Admin Order Types
// ============================================================================

/** TopUp 资金订单状态(后端 common.TopUpStatus*) */
export type TopupOrderStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'expired'
  | 'refunded'

/** 订阅订单状态 = 资金订单状态 + 转人工 */
export type SubscriptionOrderStatus = TopupOrderStatus | 'manual_review'

/** 资金订单来源:钱包充值 vs 订阅订单在充值表里的镜像行(镜像行只读) */
export type TopupOrderSource = 'wallet' | 'subscription'

/** 管理端资金订单(TopUp 全量行,含订阅订单的资金镜像) */
export interface AdminTopupOrder {
  id: number
  user_id?: number
  username?: string
  amount: number
  money: number
  trade_no: string
  payment_method: string
  payment_provider?: string
  create_time: number
  complete_time?: number
  status: TopupOrderStatus
  source: TopupOrderSource
}

/** 管理端订阅订单 */
export interface AdminSubscriptionOrder {
  id: number
  user_id: number
  username?: string
  plan_id: number
  /** 实时反查的套餐标题;套餐已删则为空 */
  plan_title?: string
  money: number
  trade_no: string
  payment_method: string
  payment_provider?: string
  status: SubscriptionOrderStatus
  order_type: 'new' | 'upgrade'
  user_subscription_id: number
  from_subscription_id: number
  create_time: number
  complete_time?: number
  /** 网关回调原文,人工审核 manual_review 时的第一手依据 */
  provider_payload?: string
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PagedData<T> {
  items: T[]
  total: number
  page?: number
  page_size?: number
}

export interface OrderListParams {
  p?: number
  page_size?: number
  keyword?: string
  status?: string
}

/**
 * 资金订单人工处理动作:补单 / 标记退款(回收额度)。
 *
 * 刻意没有「作废」:把待支付充值单改成终态会销毁「后到的付款仍能入账」的唯一
 * 前提(EpayNotify 只对 pending 发额度),详见 model/topup.go 的说明。
 * 订阅订单可以作废,因为那侧对已作废订单收到付款有 manual_review 出口。
 */
export type TopupOrderAction = 'complete' | 'refund'

/** 订阅订单人工处理动作:补发 / 关单 / 作废挂单 / 标记退款(撤销订阅) */
export type SubscriptionOrderAction = 'deliver' | 'close' | 'expire' | 'refund'
