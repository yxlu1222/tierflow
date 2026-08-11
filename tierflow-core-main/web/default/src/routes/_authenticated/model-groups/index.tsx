/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

// Model Groups is now a tab on the Model Management page (/models/groups).
// Keep this path as a permanent redirect so old bookmarks/links still work.
export const Route = createFileRoute('/_authenticated/model-groups/')({
  beforeLoad: () => {
    throw redirect({
      to: '/models/$section',
      params: { section: 'groups' },
    })
  },
})
