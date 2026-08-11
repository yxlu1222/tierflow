/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import { API_KEY_STATUSES } from '../constants'
import { type ApiKey } from '../types'
import { ApiKeyCell } from './api-keys-cells'
import { DataTableRowActions } from './data-table-row-actions'

function getQuotaProgressColor(percentage: number): string {
  if (percentage <= 10) return '[&_[data-slot=progress-indicator]]:bg-rose-500'
  if (percentage <= 30) return '[&_[data-slot=progress-indicator]]:bg-amber-500'
  return '[&_[data-slot=progress-indicator]]:bg-emerald-500'
}

export function useApiKeysColumns(): ColumnDef<ApiKey>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'name',
      header: t('Name'),
      enableSorting: false,
      cell: ({ row }) => (
        <div className='flex max-w-[240px] items-center gap-1.5'>
          <span className='truncate'>{row.getValue('name')}</span>
          {(row.original.user_subscription_id ?? 0) > 0 && (
            <Badge variant='secondary' className='shrink-0'>
              {t('Plan Key')}
            </Badge>
          )}
        </div>
      ),
      meta: { label: t('Name'), mobileTitle: true },
    },
    {
      id: 'key',
      accessorKey: 'key',
      header: t('API Key'),
      enableSorting: false,
      cell: ({ row }) => <ApiKeyCell apiKey={row.original} />,
      meta: { label: t('API Key') },
    },
    {
      id: 'quota',
      accessorKey: 'remain_quota',
      header: t('Quota'),
      enableSorting: false,
      cell: ({ row }) => {
        const apiKey = row.original
        if (apiKey.unlimited_quota) {
          return <span>{t('Unlimited')}</span>
        }

        const used = apiKey.used_quota
        const remaining = apiKey.remain_quota
        const total = used + remaining
        const percentage = total > 0 ? (remaining / total) * 100 : 0

        return (
          <Tooltip>
            <TooltipTrigger render={<div className='w-[150px] space-y-1' />}>
              <div className='flex justify-between text-xs'>
                <span className='tabular-nums'>{formatQuota(remaining)}</span>
                <span className='tabular-nums'>{formatQuota(total)}</span>
              </div>
              <Progress
                value={percentage}
                className={cn('h-1.5', getQuotaProgressColor(percentage))}
              />
            </TooltipTrigger>
            <TooltipContent>
              <div className='space-y-1 text-xs'>
                <div>
                  {t('Used:')} {formatQuota(used)}
                </div>
                <div>
                  {t('Remaining:')} {formatQuota(remaining)} (
                  {percentage.toFixed(1)}%)
                </div>
                <div>
                  {t('Total:')} {formatQuota(total)}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        )
      },
      meta: { label: t('Quota') },
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      enableSorting: false,
      cell: ({ row }) => {
        const statusConfig = API_KEY_STATUSES[row.getValue('status') as number]
        if (!statusConfig) return null
        return (
          <StatusBadge
            label={t(statusConfig.label)}
            variant={statusConfig.variant}
            showDot={false}
            copyable={false}
          />
        )
      },
      filterFn: (row, id, value) => value.includes(String(row.getValue(id))),
      meta: { label: t('Status'), mobileBadge: true },
    },
    {
      accessorKey: 'created_time',
      header: t('Created'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='[font-family:var(--font-body)] tabular-nums'>
          {formatTimestampToDate(row.getValue('created_time'))}
        </span>
      ),
      meta: { label: t('Created'), mobileHidden: true },
    },
    {
      accessorKey: 'expired_time',
      header: t('Expires'),
      enableSorting: false,
      cell: ({ row }) => {
        const expiredTime = row.getValue('expired_time') as number
        if (expiredTime === -1) {
          return <span>{t('Never')}</span>
        }
        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {formatTimestampToDate(expiredTime)}
          </span>
        )
      },
      meta: { label: t('Expires'), mobileHidden: true },
    },
    {
      accessorKey: 'accessed_time',
      header: t('Last Used'),
      enableSorting: false,
      cell: ({ row }) => {
        const accessedTime = row.getValue('accessed_time') as number
        if (!accessedTime) {
          return <span>-</span>
        }
        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {formatTimestampToDate(accessedTime)}
          </span>
        )
      },
      meta: { label: t('Last Used'), mobileHidden: true },
    },
    {
      id: 'actions',
      header: t('Actions'),
      enableSorting: false,
      cell: ({ row }) => <DataTableRowActions row={row} />,
      meta: { label: t('Actions') },
      size: 120,
    },
  ]
}
