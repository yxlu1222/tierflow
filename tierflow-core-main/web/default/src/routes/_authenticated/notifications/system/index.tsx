/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { SystemNotifications } from '@/features/notifications/system-notifications'

export const Route = createFileRoute('/_authenticated/notifications/system/')({
  beforeLoad: ({ location }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: SystemNotifications,
})
