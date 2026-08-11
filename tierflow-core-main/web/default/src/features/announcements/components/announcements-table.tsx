/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import {
  type ColumnFiltersState,
  type SortingState,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { DataTablePage } from '@/components/data-table'
import { type Announcement } from '../types'
import { useAnnouncementsData } from '../use-announcements-data'
import { useAnnouncementsColumns } from './announcements-columns'

export function AnnouncementsTable() {
  const { t } = useTranslation()
  const columns = useAnnouncementsColumns()
  const { announcements, isLoading } = useAnnouncementsData()
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [sorting, setSorting] = useState<SortingState>([])

  // 默认排序:置顶优先,再按发布时间倒序(与后端 GetAnnouncements 一致)。
  const data = useMemo(
    () =>
      [...announcements].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return (
          new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime()
        )
      }),
    [announcements]
  )

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    for (const a of announcements) {
      if (a.category) seen.add(a.category)
    }
    return [...seen].map((c) => ({ label: c, value: c }))
  }, [announcements])

  const table = useReactTable({
    data,
    columns,
    // 表头不提供排序(默认置顶优先→时间倒序),因此不显示排序上下箭头。
    enableSorting: false,
    state: { globalFilter, columnFilters, sorting },
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    globalFilterFn: (row, _columnId, filterValue) => {
      const a = row.original as Announcement
      const needle = String(filterValue).toLowerCase()
      return (
        a.title.toLowerCase().includes(needle) ||
        a.content.toLowerCase().includes(needle) ||
        a.category.toLowerCase().includes(needle)
      )
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize: 20 } },
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      unifiedLayout
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No announcements yet')}
      emptyDescription={t(
        'No announcements yet. Click "Add Announcement" to create one.'
      )}
      skeletonKeyPrefix='announcements-skeleton'
      tableClassName={cn(
        'overflow-x-auto',
        '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
        '[&_[data-slot=table]_th]:font-normal',
        '[&_[data-slot=empty-title]]:!text-xl'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
      toolbarProps={{
        className: 'px-2 py-2',
        searchPlaceholder: t('Filter by title or content...'),
        filters:
          categoryOptions.length > 0
            ? [
                {
                  columnId: 'category',
                  title: t('Category'),
                  options: categoryOptions,
                },
              ]
            : [],
      }}
    />
  )
}
