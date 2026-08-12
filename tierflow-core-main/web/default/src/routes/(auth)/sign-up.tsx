/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { APPLIANCE_SELF_REGISTRATION_ENABLED } from '@/lib/appliance-mode'
import { SignUp } from '@/features/auth/sign-up'

export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
  beforeLoad: () => {
    if (!APPLIANCE_SELF_REGISTRATION_ENABLED) {
      throw redirect({ to: '/sign-in', replace: true })
    }
  },
})
