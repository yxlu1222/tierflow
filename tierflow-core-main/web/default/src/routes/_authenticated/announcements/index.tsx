/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { Announcements } from '@/features/announcements'

export const Route = createFileRoute('/_authenticated/announcements/')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()

    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({
        to: '/403',
      })
    }
  },
  component: Announcements,
})
