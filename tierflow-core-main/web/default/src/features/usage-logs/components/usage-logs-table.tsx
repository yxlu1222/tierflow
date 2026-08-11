/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '@/hooks/use-admin'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  DataTablePage,
  LIST_CELL_CLASS,
  LIST_ROW_CLASS,
} from '@/components/data-table'
import {
  DEFAULT_LOGS_DATA,
  LOG_TYPE_ALL_VALUE,
  LOG_TYPE_ENUM,
} from '../constants'
import { useColumnsByCategory } from '../lib/columns'
import { fetchLogsByCategory } from '../lib/utils'
import type { UsageLogsSearch } from '../search-schema'
import type { LogCategory } from '../types'
import { useLogsNavigate } from '../use-logs-navigate'
import { CommonLogsFilterBar } from './common-logs-filter-bar'
import { UsageLogsMobileList } from './usage-logs-mobile-card'

const logTypeRowTint: Record<number, string> = {
  [LOG_TYPE_ENUM.ERROR]: 'bg-rose-50/40',
  [LOG_TYPE_ENUM.REFUND]: 'bg-blue-50/30',
}

function deserializeLogTypeFilter(value: unknown): unknown[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.filter((item) => String(item) !== LOG_TYPE_ALL_VALUE)
}

interface UsageLogsTableProps {
  logCategory: LogCategory
}

export function UsageLogsTable({ logCategory }: UsageLogsTableProps) {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  // 这张表没有自己的页面了(已并入看板首屏),所以不用 getRouteApi 绑死路由;
  // strict:false 读的是「当前所在路由」的 search —— 挂载它的路由必须用
  // usageLogsSearchSchema 声明这些字段,否则 Router 会把它们剥掉。
  const searchParams = useSearch({ strict: false }) as UsageLogsSearch
  const navigate = useLogsNavigate()

  const {
    columnFilters,
    onColumnFiltersChange,
    pagination,
    onPaginationChange,
    ensurePageInRange,
  } = useTableUrlState({
    search: searchParams,
    navigate,
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: false },
    columnFilters: [
      {
        columnId: 'created_at',
        searchKey: 'type',
        type: 'array' as const,
        deserialize: deserializeLogTypeFilter,
      },
      { columnId: 'strategy', searchKey: 'model', type: 'string' as const },
      { columnId: 'group', searchKey: 'group', type: 'string' as const },
      ...(isAdmin
        ? [
            {
              columnId: 'channel',
              searchKey: 'channel',
              type: 'string' as const,
            },
            {
              columnId: 'username',
              searchKey: 'username',
              type: 'string' as const,
            },
          ]
        : []),
    ],
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'logs',
      logCategory,
      isAdmin,
      pagination.pageIndex + 1,
      pagination.pageSize,
      columnFilters,
      searchParams,
      t,
    ],
    queryFn: async () => {
      const result = await fetchLogsByCategory({
        logCategory,
        isAdmin,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        searchParams,
        columnFilters,
      })

      if (!result?.success) {
        toast.error(result?.message || t('Failed to load logs'))
        return DEFAULT_LOGS_DATA
      }

      return result.data || DEFAULT_LOGS_DATA
    },
    placeholderData: (previousData, previousQuery) => {
      if (previousQuery?.queryKey[1] === logCategory) {
        return previousData
      }
      return undefined
    },
  })

  const columns = useColumnsByCategory(logCategory, isAdmin)
  const isLoadingData = isLoading || (isFetching && !data)

  const logs = data?.items || []

  const table = useReactTable({
    data: logs as Record<string, unknown>[],
    columns: columns as ColumnDef<Record<string, unknown>>[],
    state: {
      columnFilters,
      pagination,
    },
    enableRowSelection: false,
    enableSorting: false,
    onPaginationChange,
    onColumnFiltersChange,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    manualPagination: true,
    manualFiltering: true,
    pageCount: Math.ceil((data?.total ?? 0) / pagination.pageSize),
  })

  const pageCount = table.getPageCount()
  useEffect(() => {
    ensurePageInRange(pageCount)
  }, [pageCount, ensurePageInRange])

  const isCommon = logCategory === 'common'

  return (
    <DataTablePage
      table={table}
      columns={columns as ColumnDef<Record<string, unknown>>[]}
      isLoading={isLoadingData}
      isFetching={isFetching}
      unifiedLayout
      className='border-0'
      hidePageSize
      emptyTitle={t('No usage logs')}
      emptyDescription=''
      emptyIcon={null}
      skeletonKeyPrefix='usage-log-skeleton'
      tableClassName={cn(
        'overflow-x-auto',
        '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
        '[&_[data-slot=table]_th]:text-foreground',
        '[&_[data-slot=empty-title]]:!text-lg'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10'
      mobile={
        <UsageLogsMobileList
          table={table}
          isLoading={isLoadingData}
          emptyTitle={t('No usage logs')}
        />
      }
      toolbar={<CommonLogsFilterBar table={table} />}
      renderRow={(row) => {
        const logType = (row.original as Record<string, unknown>).type as
          | number
          | undefined
        const tintClass =
          isCommon && logType != null ? (logTypeRowTint[logType] ?? '') : ''

        return (
          <TableRow
            key={row.id}
            className={cn(LIST_ROW_CLASS, 'transition-colors', tintClass)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id} className={LIST_CELL_CLASS}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        )
      }}
    />
  )
}
