/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { ForgotPassword } from '@/features/auth/forgot-password'

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPassword,
})
