/*
Copyright (C) 2023-2026 TierFlow
*/
import * as React from 'react'
import { type ReactNode } from 'react'
import { type Table } from '@tanstack/react-table'
import { X as Cross2Icon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTableFacetedFilter } from './faceted-filter'
import { FilterPopover } from './filter-popover'
import { DataTableViewOptions } from './view-options'

type FilterDef = {
  columnId: string
  title: string
  options: {
    label: string
    value: string
    icon?: React.ComponentType<{ className?: string }>
    iconNode?: React.ReactNode
    count?: number
  }[]
  singleSelect?: boolean
}

export type DataTableToolbarProps<TData> = {
  table: Table<TData>
  /**
   * Placeholder for the search input. Defaults to `t('Filter...')`.
   */
  searchPlaceholder?: string
  /**
   * Column id to filter on. When provided, the search input filters
   * a specific column. When omitted, the search input updates the
   * table's `globalFilter`.
   */
  searchKey?: string
  /**
   * Column-level filter chips (faceted multi-select / single-select).
   */
  filters?: FilterDef[]
  /**
   * Extra filter inputs stacked inside the popover below the search input.
   */
  additionalSearch?: ReactNode
  /**
   * Active-condition count the toolbar cannot derive on its own — i.e. filters
   * in `additionalSearch` that don't end up as table column filters. Column
   * filters and the search input are already counted.
   */
  additionalFilterCount?: number
  /**
   * The only control allowed to stay OUTSIDE the popover: a date-range picker.
   * Date selection is too central to hide behind a button.
   */
  customSearch?: ReactNode
  /**
   * Custom action buttons rendered BEFORE the built-in Filter / Reset / View
   * buttons.
   */
  preActions?: ReactNode
  /**
   * Callback invoked when the user clicks Reset.
   */
  onReset?: () => void
  /**
   * Hide the View Options (column visibility) dropdown.
   */
  hideViewOptions?: boolean
  /**
   * Outer wrapper className override.
   */
  className?: string
}

/**
 * Unified data-table filter panel.
 *
 * Every filter — search input, extra inputs, faceted chips — is collapsed into
 * a single "Filter" popover whose trigger carries a badge with the number of
 * active conditions. The toolbar row itself only ever holds an optional date
 * range picker (`customSearch`) on the left and the action cluster on the
 * right, so every list page reads the same way.
 */
export function DataTableToolbar<TData>(props: DataTableToolbarProps<TData>) {
  const { t } = useTranslation()

  const filters = props.filters ?? []
  const { columnFilters, globalFilter } = props.table.getState()

  // The search input maps to either a column filter or the global filter; in
  // the former case it is already part of `columnFilters`, so only count the
  // global one separately. `additionalSearch` inputs typically debounce into a
  // column filter too — anything that doesn't is reported via
  // `additionalFilterCount`.
  const filterCount =
    columnFilters.length +
    (globalFilter ? 1 : 0) +
    (props.additionalFilterCount ?? 0)
  const isFiltered = filterCount > 0

  const placeholder = props.searchPlaceholder ?? t('Filter...')

  const searchInput = props.searchKey ? (
    <Input
      placeholder={placeholder}
      aria-label={placeholder}
      value={
        (props.table.getColumn(props.searchKey)?.getFilterValue() as string) ??
        ''
      }
      onChange={(event) =>
        props.table
          .getColumn(props.searchKey!)
          ?.setFilterValue(event.target.value)
      }
      className='w-full'
    />
  ) : (
    <Input
      placeholder={placeholder}
      aria-label={placeholder}
      value={globalFilter ?? ''}
      onChange={(event) => props.table.setGlobalFilter(event.target.value)}
      className='w-full'
    />
  )

  const filterChips = filters.map((filter) => {
    const column = props.table.getColumn(filter.columnId)
    if (!column) return null
    return (
      <DataTableFacetedFilter
        key={filter.columnId}
        column={column}
        title={filter.title}
        options={filter.options}
        singleSelect={filter.singleSelect}
        className='w-full justify-start'
      />
    )
  })

  const handleReset = () => {
    props.table.resetColumnFilters()
    props.table.setGlobalFilter('')
    props.onReset?.()
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 sm:gap-3',
        props.className
      )}
    >
      {props.customSearch}

      <div className='ms-auto flex shrink-0 items-center gap-1.5 sm:gap-2'>
        {props.preActions}

        <FilterPopover count={filterCount}>
          {searchInput}
          {props.additionalSearch}
          {filterChips}
        </FilterPopover>

        {isFiltered && (
          <Button
            variant='ghost'
            onClick={handleReset}
            className='text-muted-foreground hover:text-foreground gap-1 px-2'
          >
            {t('Reset')}
            <Cross2Icon />
          </Button>
        )}

        {!props.hideViewOptions && <DataTableViewOptions table={props.table} />}
      </div>
    </div>
  )
}
