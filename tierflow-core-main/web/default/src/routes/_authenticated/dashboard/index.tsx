/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/dashboard/')({
  beforeLoad: () => {
    throw redirect({
      to: '/usage',
      replace: true,
    })
  },
})
