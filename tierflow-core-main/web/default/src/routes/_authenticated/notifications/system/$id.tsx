/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { SystemNotificationDetail } from '@/features/notifications/system-notification-detail'

export const Route = createFileRoute('/_authenticated/notifications/system/$id')(
  {
    beforeLoad: ({ location }) => {
      const { auth } = useAuthStore.getState()
      if (!auth.user) {
        throw redirect({ to: '/sign-in', search: { redirect: location.href } })
      }
    },
    component: RouteComponent,
  }
)

function RouteComponent() {
  const { id } = Route.useParams()
  return <SystemNotificationDetail id={id} />
}
