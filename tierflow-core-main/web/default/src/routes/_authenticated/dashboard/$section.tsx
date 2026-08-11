/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { Dashboard } from '@/features/dashboard'
import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_DEFAULT_SECTION,
} from '@/features/dashboard/section-registry'

export const Route = createFileRoute('/_authenticated/dashboard/$section')({
  beforeLoad: ({ params }) => {
    // 这里只剩管理端的用户分析 / 财务了 —— 用户端的用量信息已独立为 /usage,
    // 所以普通用户到这儿直接送回自己的用量页,而不是 403(旧书签多半指向
    // /dashboard/overview,那本来就是他们该看的那一页)。
    const { auth } = useAuthStore.getState()
    if (!auth.user || auth.user.role < ROLE.ADMIN) {
      throw redirect({ to: '/usage', replace: true })
    }

    const validSections = DASHBOARD_SECTION_IDS as unknown as string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/dashboard/$section',
        params: { section: DASHBOARD_DEFAULT_SECTION },
        replace: true,
      })
    }
  },
  component: Dashboard,
})
