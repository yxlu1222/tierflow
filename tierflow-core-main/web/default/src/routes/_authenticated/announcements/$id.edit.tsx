/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { AnnouncementEditor } from '@/features/announcements/announcement-editor'

export const Route = createFileRoute('/_authenticated/announcements/$id/edit')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (auth.user?.role !== ROLE.SUPER_ADMIN) {
      throw redirect({ to: '/403' })
    }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { id } = Route.useParams()
  return <AnnouncementEditor id={id} />
}
