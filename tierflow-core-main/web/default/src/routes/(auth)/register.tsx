/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/(auth)/register')({
  beforeLoad: ({ location }) => {
    throw redirect({
      to: '/sign-up',
      search: location.search,
      replace: true,
    })
  },
})
