/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTableColumnHeader } from '@/components/data-table'
import { MaskedValueDisplay } from '@/components/masked-value-display'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  REDEMPTION_FILTER_EXPIRED,
  REDEMPTION_STATUSES,
  REDEMPTION_TYPE,
  REDEMPTION_TYPES,
} from '../constants'
import { isRedemptionExpired, isTimestampExpired } from '../lib'
import { type Redemption } from '../types'
import { DataTableRowActions } from './data-table-row-actions'

/**
 * @param planTitleById 套餐 id → 标题。订阅码的面额列展示套餐名而非额度数字，
 *   缺失时回退到 `#id`。
 */
export function useRedemptionsColumns(
  planTitleById: Map<number, string> = new Map()
): ColumnDef<Redemption>[] {
  const { t } = useTranslation()
  return [
    {
      id: 'select',
      meta: { label: t('Select') },
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={t('Select all')}
          className='translate-y-[2px]'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={t('Select row')}
          className='translate-y-[2px]'
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'id',
      meta: { label: t('ID'), mobileHidden: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('ID')} />
      ),
      cell: ({ row }) => {
        return (
          <TableId value={row.getValue('id') as number} className='w-[60px]' />
        )
      },
    },
    {
      accessorKey: 'name',
      meta: { label: t('Name'), mobileTitle: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Name')} />
      ),
      cell: ({ row }) => {
        return (
          <div className='max-w-[150px] truncate font-medium'>
            {row.getValue('name')}
          </div>
        )
      },
    },
    {
      accessorKey: 'status',
      meta: { label: t('Status'), mobileBadge: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Status')} />
      ),
      cell: ({ row }) => {
        const redemption = row.original
        const statusValue = row.getValue('status') as number

        // Check if expired
        if (isRedemptionExpired(redemption.expired_time, statusValue)) {
          return (
            <StatusBadge
              label={t('Expired')}
              variant='warning'
              copyable={false}
            />
          )
        }

        const statusConfig = REDEMPTION_STATUSES[statusValue]

        if (!statusConfig) {
          return null
        }

        return (
          <StatusBadge
            label={t(statusConfig.labelKey)}
            variant={statusConfig.variant}
            copyable={false}
          />
        )
      },
      filterFn: (row, id, value) => {
        const redemption = row.original
        const statusValue = row.getValue(id) as number

        // Check if expired status is being filtered
        if (value.includes(REDEMPTION_FILTER_EXPIRED)) {
          if (isRedemptionExpired(redemption.expired_time, statusValue)) {
            return true
          }
        }

        // Check regular status
        return value.includes(String(statusValue))
      },
    },
    {
      id: 'code',
      accessorKey: 'key',
      meta: { label: t('Code') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Code')} />
      ),
      cell: function CodeCell({ row }) {
        const redemption = row.original
        const key = redemption.key
        // 首 4 + 4 星 + 尾 4：够辨认也够对核，又不至于让这一列撑满表格
        const maskedKey = `${key.slice(0, 4)}****${key.slice(-4)}`

        return (
          <MaskedValueDisplay
            label={t('Full Code')}
            fullValue={key}
            maskedValue={maskedKey}
            copyTooltip={t('Copy code')}
            copyAriaLabel={t('Copy redemption code')}
          />
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'type',
      meta: { label: t('Code Type') },
      header: t('Code Type'),
      cell: ({ row }) => {
        const type = (row.original.type ?? REDEMPTION_TYPE.QUOTA) as number
        const config = REDEMPTION_TYPES[type] || REDEMPTION_TYPES[0]
        // 纯文本而非徽章：徽章的 px-1.5 会让文字比列名右移 6px
        return <span className='text-sm'>{t(config.labelKey)}</span>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'quota',
      meta: { label: t('Quota') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Quota')} />
      ),
      cell: ({ row }) => {
        // 订阅码的面额由套餐决定，quota 恒为 0，显示数字会误导
        if (row.original.type === REDEMPTION_TYPE.SUBSCRIPTION) {
          const planTitle = planTitleById.get(row.original.plan_id ?? 0)
          return (
            <span className='text-sm'>
              {planTitle || `#${row.original.plan_id ?? 0}`}
            </span>
          )
        }
        const quota = row.getValue('quota') as number
        return <span className='text-sm'>{formatQuota(quota)}</span>
      },
    },
    {
      accessorKey: 'created_time',
      meta: { label: t('Created'), mobileHidden: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Created')} />
      ),
      cell: ({ row }) => {
        return (
          <div className='min-w-[140px] font-mono text-sm'>
            {formatTimestampToDate(row.getValue('created_time'))}
          </div>
        )
      },
    },
    {
      accessorKey: 'expired_time',
      meta: { label: t('Expires'), mobileHidden: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Expires')} />
      ),
      cell: ({ row }) => {
        const expiredTime = row.getValue('expired_time') as number
        if (expiredTime === 0) {
          // 与同列的日期分支保持一致的纯文本呈现
          return <span className='text-muted-foreground text-sm'>{t('Never')}</span>
        }
        const isExpired = isTimestampExpired(expiredTime)
        return (
          <div
            className={`min-w-[140px] font-mono text-sm ${isExpired ? 'text-destructive' : ''}`}
          >
            {formatTimestampToDate(expiredTime)}
          </div>
        )
      },
    },
    {
      accessorKey: 'used_user_id',
      meta: { label: t('Redeemed By'), mobileHidden: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Redeemed By')} />
      ),
      cell: ({ row }) => {
        const userId = row.getValue('used_user_id') as number
        const redemption = row.original

        if (userId === 0) {
          return <span className='text-muted-foreground text-sm'>-</span>
        }

        // 用户名由后端批量回填；用户已被删除时回退到 id，避免显示空白
        const displayName =
          redemption.used_username || t('User {{id}}', { id: userId })

        return (
          <Tooltip>
            <TooltipTrigger
              render={<span className='cursor-help text-sm'>{displayName}</span>}
            ></TooltipTrigger>
            <TooltipContent>
              <div className='space-y-1 text-xs'>
                <div>
                  {t('User ID:')} {userId}
                </div>
                {redemption.redeemed_time > 0 && (
                  <div>
                    {t('Redeemed:')}{' '}
                    {formatTimestampToDate(redemption.redeemed_time)}
                  </div>
                )}
              </div>
            </TooltipContent>
          </Tooltip>
        )
      },
    },
    {
      id: 'actions',
      cell: ({ row }) => <DataTableRowActions row={row} />,
    },
  ]
}
