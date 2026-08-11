/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/console/log')({
  beforeLoad: () => {
    // 日志已并入用量信息页,不再跳中转的 /usage-logs,直接落到最终位置
    throw redirect({ to: '/usage' })
  },
})
