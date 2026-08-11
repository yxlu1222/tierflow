/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { Billing } from '@/features/billing'

// ?pay=success|fail|pending:支付网关浏览器回跳的结果标记(经 /console/topup
// 重定向透传),页面内 toast 提示一次后清除。pending = 已收款但转人工处理。
type BillingSearch = { pay?: 'success' | 'fail' | 'pending' }

export const Route = createFileRoute('/_authenticated/billing/')({
  validateSearch: (search: Record<string, unknown>): BillingSearch => {
    const pay = search.pay
    return pay === 'success' || pay === 'fail' || pay === 'pending'
      ? { pay }
      : {}
  },
  component: Billing,
})
