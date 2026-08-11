/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { UserAgreement } from '@/features/legal'

export const Route = createFileRoute('/user-agreement')({
  component: UserAgreement,
})
