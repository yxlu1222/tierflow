/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useState } from 'react'
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
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
} from '@/components/data-table'
import { getUsers, searchUsers } from '../api'
import { USER_STATUS, getUserRoleOptions, isUserDeleted } from '../constants'
import type { User } from '../types'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useUsersColumns } from './users-columns'
import { useUsers } from './users-provider'

const route = getRouteApi('/_authenticated/users/')

function isDisabledUserRow(user: User) {
  return isUserDeleted(user) || user.status === USER_STATUS.DISABLED
}

export function UsersTable() {
  const { t } = useTranslation()
  const columns = useUsersColumns()
  const { refreshTrigger } = useUsers()
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [rowSelection, setRowSelection] = useState({})
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const tableState = useTableUrlState({
    search: route.useSearch(),
    navigate: route.useNavigate(),
    pagination: { defaultPage: 1, defaultPageSize: isMobile ? 10 : 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [{ columnId: 'role', searchKey: 'role', type: 'array' }],
  })
  const roleFilter =
    (tableState.columnFilters.find((filter) => filter.id === 'role')?.value as
      string[] | undefined) ?? []

  const query = useQuery({
    queryKey: [
      'users',
      tableState.pagination.pageIndex + 1,
      tableState.pagination.pageSize,
      tableState.globalFilter,
      roleFilter,
      roleFilter[0],
      refreshTrigger,
    ],
    queryFn: async () => {
      const hasFilter = Boolean(tableState.globalFilter?.trim())
      const hasRoleFilter = roleFilter.length > 0
      const params = {
        p: tableState.pagination.pageIndex + 1,
        page_size: tableState.pagination.pageSize,
      }
      const result =
        hasFilter || hasRoleFilter
          ? await searchUsers({
              ...params,
              keyword: tableState.globalFilter,
              role: roleFilter[0] ?? '',
            })
          : await getUsers(params)

      if (!result.success) {
        toast.error(
          result.message ||
            (hasFilter
              ? i18next.t('Failed to search users')
              : i18next.t('Failed to load users'))
        )
        return { items: [], total: 0 }
      }
      return {
        items: result.data?.items || [],
        total: result.data?.total || 0,
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const table = useReactTable({
    data: query.data?.items || [],
    columns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters: tableState.columnFilters,
      globalFilter: tableState.globalFilter,
      pagination: tableState.pagination,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, filterValue) => {
      const searchValue = String(filterValue).toLowerCase()
      return [
        row.original.username,
        row.original.display_name,
        row.original.email,
        row.original.uid,
      ].some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(searchValue)
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onPaginationChange: tableState.onPaginationChange,
    onGlobalFilterChange: tableState.onGlobalFilterChange,
    onColumnFiltersChange: tableState.onColumnFiltersChange,
    manualPagination: true,
    pageCount: Math.ceil(
      (query.data?.total || 0) / tableState.pagination.pageSize
    ),
  })

  const pageCount = table.getPageCount()
  useEffect(() => {
    tableState.ensurePageInRange(pageCount)
  }, [pageCount, tableState.ensurePageInRange])

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={query.isLoading}
      isFetching={query.isFetching}
      unifiedLayout
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No Users Found')}
      emptyDescription={t(
        'No users available. Try adjusting your search or filters.'
      )}
      skeletonKeyPrefix='users-skeleton'
      tableClassName={cn(
        'overflow-x-auto',
        '[&_[data-slot=table]]:text-[15px] [&_[data-slot=table]_td]:py-4 [&_[data-slot=table]_th]:text-[14px]',
        '[&_[data-slot=table]_th]:font-normal',
        '[&_[data-slot=empty-title]]:!text-xl'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
      toolbarProps={{
        className: 'px-2 py-2',
        searchPlaceholder: t('Search username, name or email...'),
        filters: [
          {
            columnId: 'role',
            title: t('Role'),
            options: getUserRoleOptions(t),
            singleSelect: true,
          },
        ],
      }}
      getRowClassName={(row, options) =>
        isDisabledUserRow(row.original)
          ? options.isMobile
            ? DISABLED_ROW_MOBILE
            : DISABLED_ROW_DESKTOP
          : undefined
      }
      bulkActions={<DataTableBulkActions table={table} />}
    />
  )
}
