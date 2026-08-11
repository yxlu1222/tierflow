/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { SignUp } from '@/features/auth/sign-up'

export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
})
