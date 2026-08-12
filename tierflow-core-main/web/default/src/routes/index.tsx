/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    const user = useAuthStore.getState().auth.user
    throw redirect({
      to: user ? '/usage' : '/sign-in',
      replace: true,
    })
  },
})
