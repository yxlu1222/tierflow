/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/system-settings/')({
  beforeLoad: () => {
    throw redirect({
      to: '/system-settings/site',
    })
  },
})
