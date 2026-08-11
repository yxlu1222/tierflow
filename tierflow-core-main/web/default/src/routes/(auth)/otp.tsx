/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { Otp } from '@/features/auth/otp'

export const Route = createFileRoute('/(auth)/otp')({
  component: Otp,
})
