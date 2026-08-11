/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { PlanUsagePage } from '@/features/plan-usage'

// ?plan=<id>:营销页/外链直达某个套餐的购买弹窗
type SubscriptionSearch = {
  plan?: number
}

export const Route = createFileRoute('/_authenticated/subscription/')({
  validateSearch: (search: Record<string, unknown>): SubscriptionSearch => {
    const plan = Number(search.plan)
    return Number.isFinite(plan) && plan > 0 ? { plan } : {}
  },
  component: SubscriptionPage,
})

function SubscriptionPage() {
  const { plan } = Route.useSearch()
  return <PlanUsagePage autoOpenPlanId={plan} />
}
