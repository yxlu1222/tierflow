/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ColumnDef } from '@tanstack/react-table'
import { Pin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { DataTableColumnHeader } from '@/components/data-table'
import { StatusBadge } from '@/components/status-badge'
import { CategoryBadge } from '@/components/category-badge'
import { getPreviewText } from '@/features/dashboard/lib'
import { type Announcement, getDisplayState } from '../types'
import { AnnouncementsRowActions } from './announcements-row-actions'

export function useAnnouncementsColumns(): ColumnDef<Announcement>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'title',
      meta: { label: t('Title'), mobileTitle: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Title')} />
      ),
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className='flex max-w-[280px] items-center gap-1.5'>
            {a.pinned && (
              <Pin className='text-primary size-3.5 shrink-0 fill-current' />
            )}
            <span className='truncate font-medium'>
              {a.title?.trim() || getPreviewText(a.content)}
            </span>
          </div>
        )
      },
    },
    {
      accessorKey: 'category',
      meta: { label: t('Category') },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Category')} />
      ),
      cell: ({ row }) => {
        const category = row.getValue('category') as string
        return category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className='text-muted-foreground text-sm'>-</span>
        )
      },
      filterFn: (row, id, value: string[]) =>
        value.includes(row.getValue(id) as string),
    },
    {
      accessorKey: 'status',
      meta: { label: t('Status'), mobileBadge: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Status')} />
      ),
      cell: ({ row }) => {
        const state = getDisplayState(row.original)
        if (state === 'draft') {
          return (
            <StatusBadge label={t('Draft')} variant='neutral' copyable={false} />
          )
        }
        if (state === 'scheduled') {
          return (
            <StatusBadge
              label={t('Scheduled')}
              variant='warning'
              copyable={false}
            />
          )
        }
        return (
          <StatusBadge
            label={t('Published')}
            variant='success'
            copyable={false}
          />
        )
      },
    },
    {
      accessorKey: 'publishDate',
      meta: { label: t('Publish Date'), mobileHidden: true },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Publish Date')} />
      ),
      cell: ({ row }) => (
        <span className='text-muted-foreground text-sm tabular-nums'>
          {dayjs(row.getValue('publishDate') as string).format(
            'YYYY-MM-DD HH:mm'
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      meta: { label: t('Actions') },
      header: () => <span>{t('Actions')}</span>,
      cell: ({ row }) => <AnnouncementsRowActions row={row} />,
    },
  ]
}
