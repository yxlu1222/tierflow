/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  Ban,
  Eye,
  MoreHorizontal,
  PackageCheck,
  RotateCcw,
  XCircle,
} from 'lucide-react'
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
import type { AdminSubscriptionOrder, SubscriptionOrderAction } from '../types'

interface SubscriptionOrderRowActionsProps {
  order: AdminSubscriptionOrder
  onView: (order: AdminSubscriptionOrder) => void
  onAction: (
    order: AdminSubscriptionOrder,
    action: SubscriptionOrderAction
  ) => void
}

export function SubscriptionOrderRowActions({
  order,
  onView,
  onAction,
}: SubscriptionOrderRowActionsProps) {
  const { t } = useTranslation()
  const isManualReview = order.status === 'manual_review'
  const isPending = order.status === 'pending'
  const isSuccess = order.status === 'success'
  const hasStateActions = isManualReview || isPending || isSuccess

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
      <DropdownMenuContent align='end' className='w-[190px]'>
        <DropdownMenuItem onClick={() => onView(order)}>
          {t('View Details')}
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>

        {hasStateActions ? <DropdownMenuSeparator /> : null}

        {isManualReview ? (
          <>
            <DropdownMenuItem onClick={() => onAction(order, 'deliver')}>
              {t('Redeliver')}
              <DropdownMenuShortcut>
                <PackageCheck size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              className='text-destructive focus:text-destructive'
              onClick={() => onAction(order, 'close')}
            >
              {t('Close (Refunded)')}
              <DropdownMenuShortcut>
                <XCircle size={16} />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : null}

        {isPending ? (
          <DropdownMenuItem onClick={() => onAction(order, 'expire')}>
            {t('Void Order')}
            <DropdownMenuShortcut>
              <Ban size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        ) : null}

        {isSuccess ? (
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
