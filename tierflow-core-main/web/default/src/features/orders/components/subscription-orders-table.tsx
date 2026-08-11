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
import { StatusBadge } from '@/components/status-badge'
import { resolveSubscriptionOrder } from '../api'
import {
  getOrderStatusConfig,
  getPaymentMethodLabel,
  getSubscriptionStatusOptions,
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
  SUBSCRIPTION_ORDERS_QUERY_KEY,
  TOPUP_ORDERS_QUERY_KEY,
  useAdminOrderTable,
} from '../lib/use-admin-order-table'
import type { AdminSubscriptionOrder, SubscriptionOrderAction } from '../types'
import { OrderDetailDialog, type OrderDetailField } from './order-detail-dialog'
import { SubscriptionOrderRowActions } from './subscription-order-row-actions'

interface PendingAction {
  order: AdminSubscriptionOrder
  action: SubscriptionOrderAction
}

export function SubscriptionOrdersTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [detailOrder, setDetailOrder] = useState<AdminSubscriptionOrder | null>(
    null
  )

  const table$ = useAdminOrderTable<AdminSubscriptionOrder>('subscription')

  const resolveMutation = useMutation({
    mutationFn: ({ order, action }: PendingAction) =>
      resolveSubscriptionOrder(order.id, action),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(res.data?.message || t('Order processed successfully'))
        queryClient.invalidateQueries({
          queryKey: [SUBSCRIPTION_ORDERS_QUERY_KEY],
        })
        // 补发/关单/退款会同步资金订单(TopUp)镜像行,连带刷新
        queryClient.invalidateQueries({ queryKey: [TOPUP_ORDERS_QUERY_KEY] })
      }
      setPendingAction(null)
    },
    onError: () => setPendingAction(null),
  })

  const columns = useMemo<ColumnDef<AdminSubscriptionOrder>[]>(
    () => [
      buildTradeNoColumn<AdminSubscriptionOrder>(t),
      buildUserColumn<AdminSubscriptionOrder>(t),
      {
        accessorKey: 'plan_title',
        meta: { label: t('Plan') },
        header: t('Plan'),
        cell: ({ row }) => {
          const { plan_title, plan_id } = row.original
          return (
            <span className='max-w-[160px] truncate'>
              {plan_title || t('Plan #{{id}} (deleted)', { id: plan_id })}
            </span>
          )
        },
      },
      {
        accessorKey: 'order_type',
        meta: { label: t('Type'), mobileHidden: true },
        header: t('Type'),
        cell: ({ row }) => (
          <StatusBadge
            label={
              row.original.order_type === 'upgrade'
                ? t('Upgrade')
                : t('New Purchase')
            }
            variant={row.original.order_type === 'upgrade' ? 'info' : 'neutral'}
            copyable={false}
          />
        ),
      },
      buildStatusColumn<AdminSubscriptionOrder>(t),
      {
        accessorKey: 'payment_method',
        meta: { label: t('Payment Channel'), mobileHidden: true },
        header: t('Payment Channel'),
        cell: ({ row }) =>
          getPaymentMethodLabel(row.original.payment_method, t),
      },
      buildMoneyColumn<AdminSubscriptionOrder>(t),
      buildCreatedAtColumn<AdminSubscriptionOrder>(t),
      {
        id: 'actions',
        meta: { label: t('Actions') },
        cell: ({ row }) => (
          <SubscriptionOrderRowActions
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
      case 'deliver':
        return {
          title: t('Redeliver Subscription'),
          desc:
            order.order_type === 'upgrade'
              ? t(
                  'Order {{tradeNo}} (user {{user}}) is an upgrade order — the ¥{{money}} paid is only the price difference. Redelivering replaces the source subscription: it will be cancelled and its dedicated key disabled, exactly as the automatic upgrade would. Confirm after manual review.',
                  info
                )
              : t(
                  'Redeliver order {{tradeNo}} (¥{{money}}, user {{user}})? The subscription will be granted immediately and the order marked as success.',
                  info
                ),
          confirmText: t('Redeliver'),
          destructive: false,
        }
      case 'close':
        return {
          title: t('Close Order'),
          desc: t(
            'Close order {{tradeNo}} (¥{{money}}, user {{user}})? Only do this after refunding the user offline — the order will be marked as failed and no subscription will be granted.',
            info
          ),
          confirmText: t('Close (Refunded)'),
          destructive: true,
        }
      case 'expire':
        return {
          title: t('Void Order'),
          desc: t(
            'Void pending order {{tradeNo}} (¥{{money}}, user {{user}})? If the payment gateway still reports a verified payment afterwards, the order will be routed to manual review instead of being lost.',
            info
          ),
          confirmText: t('Void Order'),
          destructive: true,
        }
      case 'refund': {
        // 升级单的退款口径与新购不同:除差价外还要退还升级时被抵扣掉的源订阅
        // 剩余价值(折成额度),且源订阅**不恢复** —— 必须在确认框里说清楚。
        let desc: string
        if (order.order_type === 'upgrade') {
          desc = t(
            'Refund upgrade order {{tradeNo}} (user {{user}})? Both the ¥{{money}} price difference and the source subscription’s remaining value consumed by the upgrade will be returned as quota. The source subscription is NOT restored, and the subscription produced by the upgrade will be revoked. This cannot be undone.',
            info
          )
        } else if (order.payment_provider === 'balance') {
          desc = t(
            'Refund order {{tradeNo}} (¥{{money}}, user {{user}})? It was paid with wallet balance, so the charged quota will be returned to the user automatically. If the subscription it produced is still active it will be revoked. This cannot be undone.',
            info
          )
        } else {
          desc = t(
            'Mark order {{tradeNo}} (¥{{money}}, user {{user}}) as refunded? Do this only after refunding offline. If the subscription it produced is still active it will be revoked (its dedicated key disabled and group rolled back), and this cannot be undone.',
            info
          )
        }
        return {
          title: t('Mark Refunded'),
          desc,
          confirmText: t('Mark Refunded'),
          destructive: true,
        }
      }
    }
  }, [pendingAction, t])

  const detailFields = useMemo<OrderDetailField[]>(() => {
    if (!detailOrder) return []
    const cfg = getOrderStatusConfig(detailOrder.status)
    const fields: OrderDetailField[] = [
      { label: t('Order Number'), value: detailOrder.trade_no },
      { label: t('User'), value: formatOrderUser(detailOrder) },
      {
        label: t('Plan'),
        value:
          detailOrder.plan_title ||
          t('Plan #{{id}} (deleted)', { id: detailOrder.plan_id }),
      },
      {
        label: t('Type'),
        value:
          detailOrder.order_type === 'upgrade'
            ? t('Upgrade')
            : t('New Purchase'),
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
        label: t('Produced Subscription'),
        value: detailOrder.user_subscription_id
          ? `#${detailOrder.user_subscription_id}`
          : '-',
      },
    ]
    if (detailOrder.order_type === 'upgrade') {
      fields.push({
        label: t('Upgraded From Subscription'),
        value: detailOrder.from_subscription_id
          ? `#${detailOrder.from_subscription_id}`
          : '-',
      })
    }
    fields.push(
      {
        label: t('Created At'),
        value: formatTimestampToDate(detailOrder.create_time),
      },
      {
        label: t('Completed At'),
        value: detailOrder.complete_time
          ? formatTimestampToDate(detailOrder.complete_time)
          : '-',
      }
    )
    if (detailOrder.provider_payload) {
      fields.push({
        label: t('Callback Payload'),
        value: detailOrder.provider_payload,
        block: true,
      })
    }
    return fields
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
        skeletonKeyPrefix='subscription-orders-skeleton'
        tableClassName={ORDER_TABLE_CLASS}
        tableHeaderClassName={ORDER_TABLE_HEADER_CLASS}
        toolbarProps={{
          className: 'px-2 py-2',
          searchPlaceholder: t('Search by order number...'),
          filters: [
            {
              columnId: 'status',
              title: t('Status'),
              options: getSubscriptionStatusOptions(t),
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
