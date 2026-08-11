/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * /benchmark 的历史入口 —— 「性能实测」独立页已并入首页,这里只做重定向。
 * 理由同 routes/how/index.tsx:旧链接仍在外面流传,不能直接 404。
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/benchmark/')({
  beforeLoad: () => {
    throw redirect({ to: '/', hash: 'proof', replace: true })
  },
})
