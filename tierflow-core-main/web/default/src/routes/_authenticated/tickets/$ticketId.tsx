/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { TicketDetailPage } from '@/features/tickets/ticket-detail'

export const Route = createFileRoute('/_authenticated/tickets/$ticketId')({
  beforeLoad: ({ location }) => {
    const { auth } = useAuthStore.getState()
    if (!auth.user) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
  },
  component: TicketDetailPage,
})
