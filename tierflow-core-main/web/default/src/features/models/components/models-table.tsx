/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import {
  getCoreRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import { useMediaQuery } from '@/hooks'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { DataTablePage } from '@/components/data-table'
import { getModels, searchModels, getVendors } from '../api'
import { DEFAULT_PAGE_SIZE, getModelStatusOptions } from '../constants'
import { modelsQueryKeys, vendorsQueryKeys } from '../lib'
import { DataTableBulkActions } from './data-table-bulk-actions'
import { useModelsColumns } from './models-columns'
import { useModels } from './models-provider'

const route = getRouteApi('/_authenticated/models/$section')

export function ModelsTable() {
  const { t } = useTranslation()
  const { selectedVendor } = useModels()
  const isMobile = useMediaQuery('(max-width: 640px)')

  // Table state
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    description: false,
    quota_types: false,
    name_rule: false,
    created_time: false,
    icon: false,
  })
  const [rowSelection, setRowSelection] = useState({})

  // URL state management
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
    pagination: {
      defaultPage: 1,
      defaultPageSize: isMobile ? 10 : DEFAULT_PAGE_SIZE,
    },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: 'vendor_id', searchKey: 'vendor', type: 'array' },
    ],
  })

  // Extract filters from column filters
  const statusFilter =
    (columnFilters.find((f) => f.id === 'status')?.value as string[]) || []
  const vendorFilter =
    (columnFilters.find((f) => f.id === 'vendor_id')?.value as string[]) || []

  // Fetch vendors for filter
  const { data: vendorsData } = useQuery({
    queryKey: vendorsQueryKeys.list(),
    queryFn: () => getVendors({ page_size: 1000 }),
  })

  const vendors = useMemo(
    () => vendorsData?.data?.items || [],
    [vendorsData?.data?.items]
  )

  const vendorOptions = useMemo(() => {
    return vendors.map((v) => ({
      label: v.name,
      value: String(v.id),
    }))
  }, [vendors])

  // Determine whether to use search or regular list API
  const shouldSearch = Boolean(globalFilter?.trim())

  // Apply selected vendor from context or filter
  const activeVendorFilter =
    selectedVendor ||
    (vendorFilter.length > 0 && !vendorFilter.includes('all')
      ? vendorFilter[0]
      : undefined)

  // Fetch models data
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data, isLoading, isFetching } = useQuery({
    queryKey: modelsQueryKeys.list({
      keyword: globalFilter,
      vendor: activeVendorFilter,
      status:
        statusFilter.length > 0 && !statusFilter.includes('all')
          ? statusFilter[0]
          : undefined,
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    queryFn: async () => {
      if (shouldSearch || activeVendorFilter) {
        return searchModels({
          keyword: globalFilter,
          vendor: activeVendorFilter,
          status:
            statusFilter.length > 0 && !statusFilter.includes('all')
              ? statusFilter[0]
              : undefined,
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        })
      } else {
        return getModels({
          status:
            statusFilter.length > 0 && !statusFilter.includes('all')
              ? statusFilter[0]
              : undefined,
          p: pagination.pageIndex + 1,
          page_size: pagination.pageSize,
        })
      }
    },
    placeholderData: (previousData) => previousData,
  })

  const models = data?.data?.items || []
  const totalCount = data?.data?.total || 0
  const vendorCounts = data?.data?.vendor_counts

  // Columns configuration
  const columns = useModelsColumns(vendors)

  // React Table instance
  const table = useReactTable({
    data: models,
    columns,
    pageCount: Math.ceil(totalCount / pagination.pageSize),
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
      globalFilter,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange,
    onGlobalFilterChange,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  })

  // Ensure page is in range when total count changes
  const pageCount = table.getPageCount()
  useEffect(() => {
    ensurePageInRange(pageCount)
  }, [pageCount, ensurePageInRange])

  // Prepare filter options
  const vendorFilterOptions = [
    {
      label: `${t('All Vendors')}${vendorCounts?.all ? ` (${vendorCounts.all})` : ''}`,
      value: 'all',
    },
    ...vendorOptions.map((option) => ({
      label: `${option.label}${vendorCounts?.[option.value] ? ` (${vendorCounts[option.value]})` : ''}`,
      value: option.value,
    })),
  ]

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      unifiedLayout
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No Models Found')}
      emptyDescription={t(
        'No models available. Create your first model to get started.'
      )}
      skeletonKeyPrefix='model-skeleton'
      applyHeaderSize
      tableClassName={cn(
        'overflow-x-auto',
        // Unified single-card look shared with the keys / usage-log tables:
        // one uniform 14px body size across header + cells (overriding the
        // per-cell text-xs on badges/dates), unbolded headers and roomier rows.
        '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
        '[&_[data-slot=table]_th]:font-normal',
        '[&_[data-slot=empty-title]]:!text-xl'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
      toolbarProps={{
        className: 'px-2 py-2',
        searchPlaceholder: t('Filter by model name...'),
        filters: [
          {
            columnId: 'status',
            title: t('Status'),
            options: [...getModelStatusOptions(t)],
            singleSelect: true,
          },
          {
            columnId: 'vendor_id',
            title: t('Vendor'),
            options: vendorFilterOptions,
            singleSelect: true,
          },
        ],
      }}
      bulkActions={<DataTableBulkActions table={table} />}
    />
  )
}
