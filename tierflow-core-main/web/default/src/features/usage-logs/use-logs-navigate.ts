/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 日志表写 URL 用的 navigate。
 *
 * 日志表不再有自己的页面(已并入看板首屏),所以它写 search 时**不能带 `to`** ——
 * 必须停留在当前路由。而 TanStack 的全局 `useNavigate()` 在不给 `to` 的情况下会
 * 把 search 的类型收窄成「所有路由的交集」,传具体字段就报错;日志表用的
 * `useTableUrlState` 又是路由无关的通用 hook(签名收 Record)。
 *
 * 这里只做签名桥接:运行时传的就是 `{ search, replace }`,行为等价于「改当前
 * 路由的 query」。挂载它的路由需要用 usageLogsSearchSchema 声明这些字段,
 * 否则 Router 会把它们剥掉。
 */
import { useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { NavigateFn } from '@/hooks/use-table-url-state'

export function useLogsNavigate(): NavigateFn {
  const routerNavigate = useNavigate()
  return useCallback<NavigateFn>(
    (opts) => routerNavigate(opts as Parameters<typeof routerNavigate>[0]),
    [routerNavigate]
  )
}
