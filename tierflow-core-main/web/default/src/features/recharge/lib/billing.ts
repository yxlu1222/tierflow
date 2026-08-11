/*
Copyright (C) 2023-2026 TierFlow
*/
import { formatTimestampToDate } from '@/lib/format'
import type { StatusBadgeProps } from '@/components/status-badge'
import type { TopupStatus } from '../types'

// ============================================================================
// Billing Utility Functions
// ============================================================================

interface StatusConfig {
  variant: StatusBadgeProps['variant']
  label: string
}

/**
 * 订单状态徽章配置(用户账单页与管理端订单页共用的唯一出处)。
 *
 * ⚠️ 后端每新增一个会写进 TopUp.status 的状态,这里必须同步补齐 —— getStatusConfig
 * 对未知状态兜底成 pending,漏一个就会让「已退款」的订单在用户账单页显示成
 * 「待支付」,而用户的额度已经被回收。
 * 管理端还多一个 manual_review(仅订阅订单),见 features/orders/constants.ts。
 */
export const STATUS_CONFIG: Record<TopupStatus, StatusConfig> = {
  success: {
    variant: 'success',
    label: 'Success',
  },
  pending: {
    variant: 'warning',
    label: 'Pending',
  },
  expired: {
    variant: 'danger',
    label: 'Expired',
  },
  failed: {
    variant: 'danger',
    label: 'Failed',
  },
  refunded: {
    variant: 'info',
    label: 'Refunded',
  },
}

/**
 * Get status badge configuration
 */
export function getStatusConfig(status: TopupStatus): StatusConfig {
  return STATUS_CONFIG[status] || STATUS_CONFIG.pending
}

/**
 * Payment method display names —— 唯一出处。
 * balance 必须在此登记:余额支付的订阅订单会被镜像进 TopUp 表,用户账单页
 * 也会渲染这些行,少登记一个就直接显示裸串 "balance"。
 */
export const PAYMENT_METHOD_NAMES: Record<string, string> = {
  alipay: 'Alipay',
  wxpay: 'WeChat Pay',
  balance: 'Balance',
  // 与后端 model.PaymentMethodRedemption 对应；缺了这条，兑换码开通的订单
  // 会在账单页与管理端订单列表里显示未翻译的裸字符串 "redemption"
  redemption: 'Redemption Code',
}

/**
 * Get payment method display name
 */
export function getPaymentMethodName(
  method: string,
  t?: (key: string) => string
): string {
  const name = PAYMENT_METHOD_NAMES[method] || method
  return t ? t(name) : name
}

/**
 * Format timestamp to readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return formatTimestampToDate(timestamp)
}
