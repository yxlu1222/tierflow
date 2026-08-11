/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { Profile } from '@/features/profile'

export const Route = createFileRoute('/_authenticated/profile/')({
  component: Profile,
})
