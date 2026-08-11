/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useMediaQuery } from '@/hooks'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { DataTablePage } from '@/components/data-table'
import { getAdminPlans } from '@/features/subscriptions/api'
import { getRedemptions, searchRedemptions } from '../api'
import { REDEMPTION_TYPE, getRedemptionStatusOptions } from '../constants'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useRedemptionsColumns } from './redemptions-columns'
import { useRedemptions } from './redemptions-provider'

const route = getRouteApi('/_authenticated/redemption-codes/')

export function RedemptionsTable() {
  const { t } = useTranslation()
  const { refreshTrigger } = useRedemptions()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [rowSelection, setRowSelection] = useState({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const {
    globalFilter,
    onGlobalFilterChange,
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'status', searchKey: 'status', type: 'array' }],
  })

  // Fetch data with React Query
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'redemptions',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      refreshTrigger,
    ],
    queryFn: async () => {
      const hasFilter = globalFilter?.trim()
      const params = {
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      }

      const result = hasFilter
        ? await searchRedemptions({ ...params, keyword: globalFilter })
        : await getRedemptions(params)

      return {
        items: result.data?.items || [],
        total: result.data?.total || 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const redemptions = data?.items || []

  // 订阅码的面额列要展示套餐名而非额度数字。只在当前页真的有订阅码时才拉套餐——
  // 绝大多数部署的兑换码都是额度码，无条件请求等于给每次翻页多加一个无用往返。
  // 更彻底的做法是让列表接口直接回填 plan_title（可照搬 hydrateRedemptionUsernames
  // 的批量回填写法），届时这个查询可整体删除。
  const hasSubscriptionCode = redemptions.some(
    (item) => item.type === REDEMPTION_TYPE.SUBSCRIPTION
  )
  const { data: plansData } = useQuery({
    queryKey: ['redemption-codes', 'admin-plans'],
    queryFn: getAdminPlans,
    enabled: hasSubscriptionCode,
  })
  const planTitleById = useMemo(
    () =>
      new Map(
        (plansData?.data || []).map((record) => [
          record.plan.id,
          record.plan.title,
        ])
      ),
    [plansData?.data]
  )

  const columns = useRedemptionsColumns(planTitleById)

  const table = useReactTable({
    data: redemptions,
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      globalFilter,
      pagination,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, filterValue) => {
      const name = String(row.getValue('name')).toLowerCase()
      const id = String(row.getValue('id'))
      const searchValue = String(filterValue).toLowerCase()

      return name.includes(searchValue) || id.includes(searchValue)
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: !globalFilter,
    pageCount: Math.ceil((data?.total || 0) / pagination.pageSize),
  })

  const pageCount = table.getPageCount()
  useEffect(() => {
    ensurePageInRange(pageCount)
  }, [pageCount, ensurePageInRange])

  const redemptionStatusOptions = useMemo(
    () => getRedemptionStatusOptions(t),
    [t]
  )

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      unifiedLayout
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No Redemption Codes Found')}
      emptyDescription={t(
        'No redemption codes available. Create your first redemption code to get started.'
      )}
      skeletonKeyPrefix='redemptions-skeleton'
      tableClassName={cn(
        'overflow-x-auto',
        // Unified single-card look shared with the channels / users / models /
        // keys / usage-log tables: one uniform 14px body size, unbolded sticky
        // muted header, roomier rows.
        '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
        '[&_[data-slot=table]_th]:font-normal',
        '[&_[data-slot=empty-title]]:!text-xl'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
      toolbarProps={{
        className: 'px-2 py-2',
        searchPlaceholder: t('Filter by name or ID...'),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: redemptionStatusOptions,
            singleSelect: true,
          },
        ],
      }}
      // 有意不设 getRowClassName：本页刻意不给已使用/已禁用/已过期的行加
      // DISABLED_ROW_DESKTOP/MOBILE 的整行置灰与左侧竖线（产品要求，2026-08）。
      // 这与 subscriptions/users/channels 等表格的惯例不同，是取舍不是遗漏——
      // 兑换码的失效状态由「状态」列的徽章表达，不再叠加整行灰底。
      // 请勿"顺手补齐"。
      bulkActions={<DataTableBulkActions table={table} />}
    />
  )
}
