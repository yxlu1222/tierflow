/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { Pricing } from '@/features/pricing'

export const Route = createFileRoute('/pricing/')({
  component: Pricing,
})
