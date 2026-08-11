/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  type ColumnDef,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatTimestampToDate } from '@/lib/format'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTablePage } from '@/components/data-table'
import { resolveTopupOrder } from '../api'
import {
  getOrderStatusConfig,
  getPaymentMethodLabel,
  getTopupStatusOptions,
} from '../constants'
import {
  ORDER_TABLE_CLASS,
  ORDER_TABLE_HEADER_CLASS,
  buildCreatedAtColumn,
  buildMoneyColumn,
  buildStatusColumn,
  buildTradeNoColumn,
  buildUserColumn,
  formatOrderUser,
} from '../lib/order-columns'
import {
  TOPUP_ORDERS_QUERY_KEY,
  useAdminOrderTable,
} from '../lib/use-admin-order-table'
import type { AdminTopupOrder, TopupOrderAction } from '../types'
import { OrderDetailDialog, type OrderDetailField } from './order-detail-dialog'
import { TopupOrderRowActions } from './topup-order-row-actions'

interface PendingAction {
  order: AdminTopupOrder
  action: TopupOrderAction
}

export function TopupOrdersTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [detailOrder, setDetailOrder] = useState<AdminTopupOrder | null>(null)

  const table$ = useAdminOrderTable<AdminTopupOrder>('topup')

  const resolveMutation = useMutation({
    mutationFn: ({ order, action }: PendingAction) =>
      resolveTopupOrder(order.trade_no, action),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Order processed successfully'))
        queryClient.invalidateQueries({ queryKey: [TOPUP_ORDERS_QUERY_KEY] })
      }
      setPendingAction(null)
    },
    onError: () => setPendingAction(null),
  })

  const columns = useMemo<ColumnDef<AdminTopupOrder>[]>(
    () => [
      buildTradeNoColumn<AdminTopupOrder>(t),
      buildUserColumn<AdminTopupOrder>(t),
      {
        accessorKey: 'payment_method',
        meta: { label: t('Payment Channel'), mobileHidden: true },
        header: t('Payment Channel'),
        cell: ({ row }) =>
          getPaymentMethodLabel(row.original.payment_method, t),
      },
      buildStatusColumn<AdminTopupOrder>(t),
      buildMoneyColumn<AdminTopupOrder>(t),
      buildCreatedAtColumn<AdminTopupOrder>(t),
      {
        id: 'actions',
        meta: { label: t('Actions') },
        cell: ({ row }) => (
          <TopupOrderRowActions
            order={row.original}
            onView={setDetailOrder}
            onAction={(order, action) => setPendingAction({ order, action })}
          />
        ),
      },
    ],
    [t]
  )

  const table = useReactTable({
    data: table$.items,
    columns,
    state: {
      pagination: table$.pagination,
      globalFilter: table$.globalFilter,
      columnFilters: table$.columnFilters,
    },
    onPaginationChange: table$.setPagination,
    onGlobalFilterChange: table$.setGlobalFilter,
    onColumnFiltersChange: table$.setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    manualPagination: true,
    manualFiltering: true,
    pageCount: table$.pageCount,
  })

  const confirmCopy = useMemo(() => {
    if (!pendingAction) return null
    const { order, action } = pendingAction
    const info = {
      tradeNo: order.trade_no,
      money: Number(order.money || 0).toFixed(2),
      user: formatOrderUser(order),
    }
    switch (action) {
      case 'complete':
        return {
          title: t('Complete Order'),
          desc: t(
            'Confirm that payment for order {{tradeNo}} (¥{{money}}, user {{user}}) has been received. Completing will credit the quota to the user immediately.',
            info
          ),
          confirmText: t('Complete Order'),
          destructive: false,
        }
      case 'refund':
        return {
          title: t('Mark Refunded'),
          desc: t(
            'Mark order {{tradeNo}} (¥{{money}}, user {{user}}) as refunded? Do this only after refunding offline. The previously credited quota will be clawed back (down to zero, never negative) and this cannot be undone.',
            info
          ),
          confirmText: t('Mark Refunded'),
          destructive: true,
        }
    }
  }, [pendingAction, t])

  const detailFields = useMemo<OrderDetailField[]>(() => {
    if (!detailOrder) return []
    const cfg = getOrderStatusConfig(detailOrder.status)
    return [
      { label: t('Order Number'), value: detailOrder.trade_no },
      { label: t('User'), value: formatOrderUser(detailOrder) },
      {
        label: t('Source'),
        value:
          detailOrder.source === 'subscription'
            ? t('Subscription Order')
            : t('Wallet Recharge'),
      },
      { label: t('Status'), value: t(cfg.labelKey) },
      {
        label: t('Amount'),
        value: `¥${Number(detailOrder.money || 0).toFixed(2)}`,
      },
      {
        label: t('Payment Provider'),
        value: detailOrder.payment_provider || '-',
      },
      {
        label: t('Payment Channel'),
        value: getPaymentMethodLabel(detailOrder.payment_method, t),
      },
      {
        label: t('Created At'),
        value: formatTimestampToDate(detailOrder.create_time),
      },
      {
        label: t('Completed At'),
        value: detailOrder.complete_time
          ? formatTimestampToDate(detailOrder.complete_time)
          : '-',
      },
    ]
  }, [detailOrder, t])

  return (
    <>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={table$.isLoading}
        isFetching={table$.isFetching}
        unifiedLayout
        className='border-0'
        emptyIcon={null}
        emptyTitle={t('No orders found')}
        emptyDescription=''
        skeletonKeyPrefix='topup-orders-skeleton'
        tableClassName={ORDER_TABLE_CLASS}
        tableHeaderClassName={ORDER_TABLE_HEADER_CLASS}
        toolbarProps={{
          className: 'px-2 py-2',
          searchPlaceholder: t('Search by order number...'),
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: getTopupStatusOptions(t),
              singleSelect: true,
            },
          ],
        }}
      />

      <ConfirmDialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
        title={confirmCopy?.title ?? ''}
        desc={confirmCopy?.desc ?? ''}
        confirmText={confirmCopy?.confirmText}
        destructive={confirmCopy?.destructive}
        isLoading={resolveMutation.isPending}
        handleConfirm={() => {
          if (pendingAction) resolveMutation.mutate(pendingAction)
        }}
      />

      <OrderDetailDialog
        open={!!detailOrder}
        onOpenChange={(open) => {
          if (!open) setDetailOrder(null)
        }}
        title={t('Order Details')}
        fields={detailFields}
      />
    </>
  )
}
