/*
Copyright (C) 2023-2026 TierFlow
*/
import { BadgeCheck, Eye, MoreHorizontal, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RETIRED_PAYMENT_PROVIDERS } from '../constants'
import type { AdminTopupOrder, TopupOrderAction } from '../types'

interface TopupOrderRowActionsProps {
  order: AdminTopupOrder
  onView: (order: AdminTopupOrder) => void
  onAction: (order: AdminTopupOrder, action: TopupOrderAction) => void
}

export function TopupOrderRowActions({
  order,
  onView,
  onAction,
}: TopupOrderRowActionsProps) {
  const { t } = useTranslation()
  // 订阅镜像行只读:状态变更须走订阅订单页,避免与 SubscriptionOrder 脱节。
  const isSubscription = order.source === 'subscription'
  const isRetiredGateway = RETIRED_PAYMENT_PROVIDERS.includes(
    order.payment_provider ?? ''
  )
  const canComplete =
    !isSubscription && order.status === 'pending' && !isRetiredGateway
  // 刻意不提供「作废」:见 types.ts 中 TopupOrderAction 的说明
  const canRefund =
    !isSubscription && order.status === 'success' && !isRetiredGateway
  const hasStateActions = canComplete || canRefund

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant='ghost'
            className='data-popup-open:bg-muted flex h-8 w-8 p-0'
          />
        }
      >
        <MoreHorizontal className='h-4 w-4' />
        <span className='sr-only'>{t('Open menu')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[180px]'>
        <DropdownMenuItem onClick={() => onView(order)}>
          {t('View Details')}
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>

        {hasStateActions ? <DropdownMenuSeparator /> : null}

        {canComplete ? (
          <DropdownMenuItem onClick={() => onAction(order, 'complete')}>
            {t('Complete Order')}
            <DropdownMenuShortcut>
              <BadgeCheck size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}

        {canRefund ? (
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onClick={() => onAction(order, 'refund')}
          >
            {t('Mark Refunded')}
            <DropdownMenuShortcut>
              <RotateCcw size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
