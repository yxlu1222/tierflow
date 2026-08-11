/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { UsagePage } from '@/features/dashboard/usage-page'
import { usageLogsSearchSchema } from '@/features/usage-logs/search-schema'

export const Route = createFileRoute('/_authenticated/usage')({
  // 页面内嵌了完整的活动日志表,它的筛选/翻页写在 URL 上;不声明这套 search
  // 字段的话 TanStack Router 会把它们剥掉,筛选一点就丢。
  validateSearch: usageLogsSearchSchema,
  component: UsagePage,
})
