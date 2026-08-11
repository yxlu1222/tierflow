/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type SortingState,
  type VisibilityState,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  DISABLED_ROW_DESKTOP,
  DISABLED_ROW_MOBILE,
  DataTablePage,
} from '@/components/data-table'
import { getAdminPlans } from '../api'
import { useSubscriptionsColumns } from './subscriptions-columns'
import { useSubscriptions } from './subscriptions-provider'

export function SubscriptionsTable() {
  const { t } = useTranslation()
  const columns = useSubscriptionsColumns()
  const { refreshTrigger } = useSubscriptions()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

  const { data, isLoading } = useQuery({
    queryKey: ['admin-subscription-plans', refreshTrigger],
    queryFn: async () => {
      const result = await getAdminPlans()
      return result.data || []
    },
    placeholderData: (prev) => prev,
  })

  const plans = useMemo(() => data || [], [data])

  const table = useReactTable({
    data: plans,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      unifiedLayout
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No subscription plans yet')}
      emptyDescription={t(
        'Click "Create Plan" to create your first subscription plan'
      )}
      skeletonKeyPrefix='subscriptions-skeleton'
      tableClassName={cn(
        'overflow-x-auto',
        // Unified single-card look shared with the channels / users / models /
        // keys / usage-log / redemption tables: one uniform 14px body size,
        // unbolded sticky muted header, roomier rows.
        '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
        '[&_[data-slot=table]_th]:font-normal',
        '[&_[data-slot=empty-title]]:!text-xl'
      )}
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
      getRowClassName={(row, { isMobile }) =>
        row.original.plan.enabled
          ? undefined
          : isMobile
            ? DISABLED_ROW_MOBILE
            : DISABLED_ROW_DESKTOP
      }
    />
  )
}
