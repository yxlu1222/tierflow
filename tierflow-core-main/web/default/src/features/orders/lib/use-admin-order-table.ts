/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 管理端订单表的公共骨架 —— 两个标签页(资金订单 / 订阅订单)共用。
 *
 * 收敛的是两表逐字重复的那部分:分页 / 关键字 / 单选状态过滤三组 state、
 * 从 columnFilters 取状态值、筛选变化回到第一页、以及服务端分页取数的
 * useQuery 形状(同样的 queryKey 布局与 {items,total} 解包)。
 *
 * 不收敛列定义与行为动作 —— 那两部分两表真正不同(订阅订单多出套餐/类型列,
 * 动作集也不同),硬抽成配置只会把差异藏进参数里。
 *
 * 取数函数由 `kind` 在此映射,而不是当参数传进来:函数入参无法放进 queryKey
 * (函数不可序列化,且内联箭头每帧换标识),会触发 @tanstack/query 的
 * exhaustive-deps 告警;由 hook 自己持有映射则 kind 本身就是判别键。
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type ColumnFiltersState,
  type PaginationState,
} from '@tanstack/react-table'
import { getAdminSubscriptionOrders, getAdminTopupOrders } from '../api'
import type { ApiResponse, OrderListParams, PagedData } from '../types'

const DEFAULT_PAGE_SIZE = 20

/** react-query key 前缀;跨表联动刷新(订阅动作会改 TopUp 镜像行)也用它 */
export const TOPUP_ORDERS_QUERY_KEY = 'admin-topup-orders'
export const SUBSCRIPTION_ORDERS_QUERY_KEY = 'admin-subscription-orders'

export type AdminOrderKind = 'topup' | 'subscription'

const FETCHERS: Record<
  AdminOrderKind,
  {
    queryKey: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetch: (params: OrderListParams) => Promise<ApiResponse<PagedData<any>>>
  }
> = {
  topup: { queryKey: TOPUP_ORDERS_QUERY_KEY, fetch: getAdminTopupOrders },
  subscription: {
    queryKey: SUBSCRIPTION_ORDERS_QUERY_KEY,
    fetch: getAdminSubscriptionOrders,
  },
}

export interface AdminOrderTableState<T> {
  items: T[]
  total: number
  isLoading: boolean
  isFetching: boolean
  pagination: PaginationState
  setPagination: React.Dispatch<React.SetStateAction<PaginationState>>
  globalFilter: string
  setGlobalFilter: React.Dispatch<React.SetStateAction<string>>
  columnFilters: ColumnFiltersState
  setColumnFilters: React.Dispatch<React.SetStateAction<ColumnFiltersState>>
  /** 供 useReactTable 的 pageCount */
  pageCount: number
}

export function useAdminOrderTable<T>(
  kind: AdminOrderKind
): AdminOrderTableState<T> {
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: DEFAULT_PAGE_SIZE,
  })
  const [globalFilter, setGlobalFilterState] = useState('')
  const [columnFilters, setColumnFiltersState] = useState<ColumnFiltersState>(
    []
  )

  // 回到第一页写在 setter 里而不是 useEffect 里:翻页重置是「用户改了筛选」的
  // 直接结果,不是需要同步的外部状态。放进 effect 会同步 setState 触发级联渲染
  // (react-hooks/set-state-in-effect)。
  const resetPage = useCallback(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }))
  }, [])

  const setGlobalFilter = useCallback<
    React.Dispatch<React.SetStateAction<string>>
  >(
    (value) => {
      setGlobalFilterState(value)
      resetPage()
    },
    [resetPage]
  )

  const setColumnFilters = useCallback<
    React.Dispatch<React.SetStateAction<ColumnFiltersState>>
  >(
    (value) => {
      setColumnFiltersState(value)
      resetPage()
    },
    [resetPage]
  )

  // 工具栏的状态过滤是 singleSelect,但 faceted filter 存的仍是数组
  const statusFilter = useMemo(() => {
    const raw = columnFilters.find((f) => f.id === 'status')?.value
    return Array.isArray(raw) ? ((raw[0] as string) ?? '') : ''
  }, [columnFilters])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      FETCHERS[kind].queryKey,
      kind,
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      statusFilter,
    ],
    queryFn: async () => {
      const res = await FETCHERS[kind].fetch({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
        keyword: globalFilter.trim() || undefined,
        status: statusFilter || undefined,
      })
      return {
        items: (res.data?.items ?? []) as T[],
        total: res.data?.total ?? 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const total = data?.total ?? 0

  return {
    items: data?.items ?? [],
    total,
    isLoading,
    isFetching,
    pagination,
    setPagination,
    globalFilter,
    setGlobalFilter,
    columnFilters,
    setColumnFilters,
    pageCount: Math.ceil(total / pagination.pageSize),
  }
}
