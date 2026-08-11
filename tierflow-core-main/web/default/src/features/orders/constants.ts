/*
Copyright (C) 2023-2026 TierFlow
*/
import { type TFunction } from 'i18next'
import { type StatusBadgeProps } from '@/components/status-badge'
import {
  STATUS_CONFIG,
  getPaymentMethodName,
} from '@/features/recharge/lib/billing'

// ============================================================================
// Order Status Configuration
// ============================================================================

/**
 * 管理端订单状态徽章配置 = 用户账单页那份唯一映射(recharge 的 STATUS_CONFIG)
 * + 仅管理端可见的 manual_review。
 *
 * 刻意复用而不是再写一份:两份拷贝漂移的直接后果就是同一笔订单在用户账单页和
 * 管理端订单页显示成不同状态 —— 上一版正是漏了 failed/refunded,导致已退款订单
 * 在用户侧兜底显示为「待支付」。
 * label 存的是 i18n key,组件里用 t(config.labelKey)。
 */
export const ORDER_STATUS_CONFIG: Record<
  string,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  ...Object.fromEntries(
    Object.entries(STATUS_CONFIG).map(([status, cfg]) => [
      status,
      { labelKey: cfg.label, variant: cfg.variant },
    ])
  ),
  manual_review: { labelKey: 'Manual Review', variant: 'danger' },
}

export function getOrderStatusConfig(status: string) {
  return ORDER_STATUS_CONFIG[status] ?? ORDER_STATUS_CONFIG.pending
}

const TOPUP_STATUS_VALUES = [
  'pending',
  'success',
  'failed',
  'expired',
  'refunded',
] as const
const SUBSCRIPTION_STATUS_VALUES = [
  'pending',
  'success',
  'manual_review',
  'failed',
  'expired',
  'refunded',
] as const

export function getTopupStatusOptions(t: TFunction) {
  return TOPUP_STATUS_VALUES.map((value) => ({
    label: t(ORDER_STATUS_CONFIG[value].labelKey),
    value,
  }))
}

export function getSubscriptionStatusOptions(t: TFunction) {
  return SUBSCRIPTION_STATUS_VALUES.map((value) => ({
    label: t(ORDER_STATUS_CONFIG[value].labelKey),
    value,
  }))
}

// ============================================================================
// Payment Method / Provider
// ============================================================================

/**
 * 支付方式展示名 —— 直接复用 recharge 的唯一映射,不再另存一份。
 * (此前这里有一份独立拷贝且只有它认识 balance,导致同一笔余额订单在管理端显示
 * 「余额」、在用户账单页显示裸串 "balance"。)
 */
export function getPaymentMethodLabel(method: string, t: TFunction): string {
  return getPaymentMethodName(method, t) || '-'
}

/**
 * 已下线的支付网关:后端 ManualCompleteTopUp 会拒绝为这些订单补单
 * (各网关额度换算规则不同,代码路径已删除),前端不展示补单按钮。
 */
export const RETIRED_PAYMENT_PROVIDERS = [
  'stripe',
  'creem',
  'waffo',
  'waffo_pancake',
]
