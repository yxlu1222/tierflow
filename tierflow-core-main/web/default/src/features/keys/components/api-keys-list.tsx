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
import { useDebounce } from '@/hooks'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useTableUrlState } from '@/hooks/use-table-url-state'
import { Input } from '@/components/ui/input'
import { DISABLED_ROW_DESKTOP, DataTablePage } from '@/components/data-table'
import { getApiKeys, searchApiKeys } from '../api'
import {
  API_KEY_STATUS,
  API_KEY_STATUS_OPTIONS,
  ERROR_MESSAGES,
} from '../constants'
import { type ApiKey } from '../types'
import { useApiKeysColumns } from './api-keys-columns'
import { ApiKeysHero } from './api-keys-hero'
import { useApiKeys } from './api-keys-provider'

const route = getRouteApi('/_authenticated/keys/')

function isDisabledApiKeyRow(apiKey: ApiKey) {
  return apiKey.status !== API_KEY_STATUS.ENABLED
}

export function ApiKeysList() {
  const { t } = useTranslation()
  const { refreshTrigger } = useApiKeys()
  const columns = useApiKeysColumns()
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
    pagination: { defaultPage: 1, defaultPageSize: 20 },
    globalFilter: { enabled: true, key: 'filter' },
    columnFilters: [
      { columnId: 'status', searchKey: 'status', type: 'array' },
      { columnId: '_tokenSearch', searchKey: 'token', type: 'string' },
    ],
  })

  const tokenFilterFromUrl =
    (columnFilters.find((f) => f.id === '_tokenSearch')?.value as string) || ''
  const [tokenFilterInput, setTokenFilterInput] = useState(tokenFilterFromUrl)
  const debouncedTokenFilter = useDebounce(tokenFilterInput, 500)

  useEffect(() => {
    setTokenFilterInput(tokenFilterFromUrl)
  }, [tokenFilterFromUrl])

  useEffect(() => {
    if (debouncedTokenFilter !== tokenFilterFromUrl) {
      onColumnFiltersChange((prev) => {
        const filtered = prev.filter((f) => f.id !== '_tokenSearch')
        return debouncedTokenFilter
          ? [...filtered, { id: '_tokenSearch', value: debouncedTokenFilter }]
          : filtered
      })
    }
  }, [debouncedTokenFilter, tokenFilterFromUrl, onColumnFiltersChange])

  const tokenFilter = tokenFilterFromUrl
  const shouldSearch = Boolean(globalFilter?.trim() || tokenFilter.trim())

  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'keys',
      pagination.pageIndex + 1,
      pagination.pageSize,
      globalFilter,
      tokenFilter,
      refreshTrigger,
    ],
    queryFn: async () => {
      const result = shouldSearch
        ? await searchApiKeys({
            keyword: globalFilter,
            token: tokenFilter,
            p: pagination.pageIndex + 1,
            size: pagination.pageSize,
          })
        : await getApiKeys({
            p: pagination.pageIndex + 1,
            size: pagination.pageSize,
          })

      if (!result.success) {
        toast.error(
          result.message ||
            t(
              shouldSearch
                ? ERROR_MESSAGES.SEARCH_FAILED
                : ERROR_MESSAGES.LOAD_FAILED
            )
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

  const apiKeys = data?.items || []

  const table = useReactTable({
    data: apiKeys,
    columns,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
      globalFilter,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: () => true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    onPaginationChange,
    onGlobalFilterChange,
    onColumnFiltersChange,
    manualPagination: true,
    pageCount: Math.ceil((data?.total || 0) / pagination.pageSize),
  })

  const pageCount = table.getPageCount()
  useEffect(() => {
    ensurePageInRange(pageCount)
  }, [pageCount, ensurePageInRange])

  return (
    <div className='flex flex-col gap-4'>
      <ApiKeysHero />

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={isLoading}
        isFetching={isFetching}
        unifiedLayout
        className='border-0'
        hidePageSize
        emptyIcon={null}
        emptyTitle={t('No available API keys')}
        emptyDescription=''
        skeletonKeyPrefix='api-keys-skeleton'
        tableClassName={cn(
          'overflow-x-auto',
          // Match the usage-logs table typography: force a uniform 14px body
          // size across header + cells (overriding per-cell text-xs) and a
          // roomier row height, so the two tables read identically.
          '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
          // Flat monochrome look: headers + body cells are unbolded (status
          // badges keep their own weight); only the Status column stays colored.
          '[&_[data-slot=table]_th]:font-normal [&_[data-slot=table]_td]:font-normal',
          '[&_[data-slot=empty-title]]:!text-xl'
        )}
        tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
        toolbarProps={{
          className: 'px-2 py-2',
          hideViewOptions: true,
          searchPlaceholder: t('Filter by name...'),
          additionalSearch: (
            <Input
              placeholder={t('Filter by API key...')}
              aria-label={t('Filter by API key...')}
              value={tokenFilterInput}
              onChange={(e) => setTokenFilterInput(e.target.value)}
              className='w-full'
            />
          ),
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: API_KEY_STATUS_OPTIONS,
              singleSelect: true,
            },
          ],
        }}
        getRowClassName={(row) =>
          isDisabledApiKeyRow(row.original) ? DISABLED_ROW_DESKTOP : undefined
        }
      />
    </div>
  )
}
