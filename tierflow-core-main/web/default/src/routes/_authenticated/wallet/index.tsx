/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

// Legacy route: the wallet page was split into Bills (/billing) and
// Recharge (/recharge). Keep /wallet as a redirect so old links stay valid.
export const Route = createFileRoute('/_authenticated/wallet/')({
  beforeLoad: () => {
    throw redirect({ to: '/billing' })
  },
})
