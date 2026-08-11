/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { PrivacyPolicy } from '@/features/legal'

export const Route = createFileRoute('/privacy-policy')({
  component: PrivacyPolicy,
})
