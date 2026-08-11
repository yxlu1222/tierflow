/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

// Legacy topup entry — order history now lives on the Bills page (/billing).
// 支付网关的浏览器回跳(?pay=success|fail|pending)落在本路由,重定向时必须
// 带上 search,否则「支付结果提示」在账单页永远渲染不出来(转人工的付款
// 会被用户当成什么都没发生)。
type PayResult = { pay?: 'success' | 'fail' | 'pending' }

export const Route = createFileRoute('/console/topup')({
  validateSearch: (search: Record<string, unknown>): PayResult => {
    const pay = search.pay
    return pay === 'success' || pay === 'fail' || pay === 'pending'
      ? { pay }
      : {}
  },
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/billing', search })
  },
})
