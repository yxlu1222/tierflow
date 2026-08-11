/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { Recharge } from '@/features/recharge'

export const Route = createFileRoute('/_authenticated/recharge/')({
  component: Recharge,
})
