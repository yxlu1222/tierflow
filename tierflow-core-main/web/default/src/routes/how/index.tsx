/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * /how 的历史入口 —— 「工作原理」独立页已并入首页,这里只做重定向。
 * 文档站、搜索引擎收录与已发出的推广物料里仍有指向 /how 的链接,直接删路由
 * 会让这些流量落到 404,所以保留一个跳转壳。
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/how/')({
  beforeLoad: () => {
    throw redirect({ to: '/', hash: 'how', replace: true })
  },
})
