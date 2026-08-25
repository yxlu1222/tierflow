/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ColumnDef } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '@/components/data-table'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { USER_ROLES } from '../constants'
import type { User } from '../types'
import { DataTableRowActions } from './data-table-row-actions'

export function useUsersColumns(): ColumnDef<User>[] {
  const { t } = useTranslation()

  return [
    {
      id: 'select',
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
      meta: { label: t('Select') },
    },
    {
      accessorKey: 'username',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('User')} />
      ),
      cell: ({ row }) => (
        <div className='flex min-w-[190px] items-center gap-3'>
          <span className='flex size-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-600'>
            {(row.original.display_name || row.original.username)
              .trim()
              .slice(0, 1)
              .toUpperCase()}
          </span>
          <div className='min-w-0'>
            <LongText className='max-w-[180px] text-base font-medium text-slate-900'>
              {row.original.display_name || row.original.username}
            </LongText>
            <LongText className='mt-0.5 max-w-[210px] text-sm text-slate-500'>
              {row.original.email || row.original.username}
            </LongText>
          </div>
        </div>
      ),
      enableHiding: false,
      meta: { label: t('User'), mobileTitle: true },
    },
    {
      accessorKey: 'role',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Role')} />
      ),
      cell: ({ row }) => {
        const role = USER_ROLES[row.original.role as keyof typeof USER_ROLES]
        if (!role) return '-'
        const Icon = role.icon
        return (
          <div className='flex items-center gap-2 text-base text-slate-700'>
            <Icon className='size-4 text-slate-400' />
            {t(role.labelKey)}
          </div>
        )
      },
      filterFn: (row, id, value) => value.includes(String(row.getValue(id))),
      enableSorting: false,
      meta: { label: t('Role') },
    },
    {
      accessorKey: 'used_quota',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Token usage')} />
      ),
      cell: ({ row }) => (
        <span className='font-mono text-base font-semibold text-slate-800 tabular-nums'>
          {formatNumber(Number(row.original.used_quota || 0))}
        </span>
      ),
      meta: { label: t('Token usage') },
    },
    {
      accessorKey: 'skill_count',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Skills')} />
      ),
      cell: ({ row }) => (
        <StatusBadge
          label={t('{{count}} Skills', {
            count: Number(row.original.skill_count || 0),
          })}
          variant='neutral'
          copyable={false}
        />
      ),
      meta: { label: t('Skills') },
    },
    {
      accessorKey: 'api_key_count',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('API Keys')} />
      ),
      cell: ({ row }) => (
        <span className='font-mono text-base font-semibold text-blue-600 tabular-nums'>
          {formatNumber(Number(row.original.api_key_count || 0))}
        </span>
      ),
      meta: { label: t('API Keys') },
    },
    {
      id: 'actions',
      cell: ({ row }) => <DataTableRowActions row={row} />,
      meta: { label: t('Actions') },
    },
  ]
}
