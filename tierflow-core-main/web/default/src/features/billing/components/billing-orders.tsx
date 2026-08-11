/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type ColumnDef,
  type PaginationState,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { DataTablePage } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { getUserBillingHistory, isApiSuccess } from '@/features/recharge/api'
import {
  getStatusConfig,
  getPaymentMethodName,
  formatTimestamp,
} from '@/features/recharge/lib/billing'
import type { TopupRecord } from '@/features/recharge/types'

const PAGE_SIZE = 10

function useOrderColumns(): ColumnDef<TopupRecord, unknown>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'trade_no',
        header: t('Order Number'),
        cell: ({ row }) => (
          <span className='text-foreground tabular-nums'>
            {row.original.trade_no}
          </span>
        ),
      },
      {
        accessorKey: 'payment_method',
        header: t('Payment Channel'),
        cell: ({ row }) => getPaymentMethodName(row.original.payment_method, t),
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => {
          const cfg = getStatusConfig(row.original.status)
          return (
            <StatusBadge
              label={t(cfg.label)}
              variant={cfg.variant}
              showDot={false}
              copyable={false}
            />
          )
        },
      },
      {
        accessorKey: 'amount',
        header: t('Amount'),
        cell: ({ row }) => (
          // 展示实付金额(money,人民币)。旧实现展示 amount(USD 折算),
          // 订阅类订单 amount 恒为 0(额度不入钱包),导致账单金额显示 0。
          <span className='font-medium tabular-nums'>
            ¥{Number(row.original.money || 0).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: 'create_time',
        header: t('Created At'),
        cell: ({ row }) => (
          <span className='text-foreground whitespace-nowrap tabular-nums'>
            {formatTimestamp(row.original.create_time)}
          </span>
        ),
      },
    ],
    [t]
  )
}

export function BillingOrders() {
  const { t } = useTranslation()
  const columns = useOrderColumns()
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['billing-orders', pagination.pageIndex + 1, pagination.pageSize],
    queryFn: async () => {
      const res = await getUserBillingHistory(
        pagination.pageIndex + 1,
        pagination.pageSize
      )
      if (isApiSuccess(res) && res.data) {
        return { items: res.data.items ?? [], total: res.data.total ?? 0 }
      }
      return { items: [], total: 0 }
    },
    placeholderData: (previousData) => previousData,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0

  const table = useReactTable({
    data: items,
    columns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(total / pagination.pageSize),
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={isLoading}
      isFetching={isFetching}
      unifiedLayout
      hideMobile
      hidePageSize
      toolbarProps={null}
      className='border-0'
      emptyIcon={null}
      emptyTitle={t('No billing records found')}
      emptyDescription=''
      skeletonKeyPrefix='billing-orders-skeleton'
      tableClassName='overflow-x-auto [&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px] [&_[data-slot=table]_th]:font-normal [&_[data-slot=table]_td]:font-normal [&_[data-slot=empty-title]]:!text-xl'
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
    />
  )
}
