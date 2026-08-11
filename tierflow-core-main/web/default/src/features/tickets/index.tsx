/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  type ColumnDef,
  type PaginationState,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { LayoutGrid, List } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { Button } from '@/components/ui/button'
import { DataTablePage } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { adminGetTicketStats, adminListTickets } from './api'
import { TicketsBoard } from './components/tickets-board'
import { TicketsStatsHero } from './components/tickets-stats-hero'
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from './constants'
import { formatTicketTime } from './lib/format'
import { ticketsQueryKeys } from './lib/query-keys'
import type { Ticket } from './types'

type ViewMode = 'board' | 'list'

export function TicketManagement() {
  const { t } = useTranslation()
  const [view, setView] = useState<ViewMode>('board')

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ticketsQueryKeys.stats(),
    queryFn: async () => {
      const res = await adminGetTicketStats()
      return res.data
    },
  })

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Ticket Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {/* 分段控件：托盘随按钮一并药丸化，避免圆角托盘里套圆形按钮 */}
        <div className='bg-muted flex items-center gap-0.5 rounded-full p-0.5'>
          <Button
            variant={view === 'board' ? 'outline' : 'ghost'}
            size='pill'
            onClick={() => setView('board')}
          >
            <LayoutGrid className='size-4' />
            {t('Board')}
          </Button>
          <Button
            variant={view === 'list' ? 'outline' : 'ghost'}
            size='pill'
            onClick={() => setView('list')}
          >
            <List className='size-4' />
            {t('List')}
          </Button>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-5'>
          <TicketsStatsHero stats={stats} isLoading={statsLoading} />
          {view === 'board' ? <TicketsBoard /> : <TicketsList />}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

const LIST_PAGE_SIZE = 20

function useTicketColumns(
  onView: (ticket: Ticket) => void
): ColumnDef<Ticket, unknown>[] {
  const { t } = useTranslation()
  return useMemo(
    () => [
      {
        accessorKey: 'ticket_no',
        header: t('Ticket No.'),
        cell: ({ row }) => (
          <span className='text-muted-foreground tabular-nums'>
            {row.original.ticket_no}
          </span>
        ),
      },
      {
        accessorKey: 'title',
        header: t('Title'),
        cell: ({ row }) => (
          <span className='text-foreground block max-w-[26rem] truncate font-medium'>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: 'username',
        header: t('User'),
        cell: ({ row }) => (
          <span className='flex items-center gap-2'>
            <span
              className='border-border flex size-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold'
              style={getUserAvatarStyle(row.original.username)}
              title={row.original.username}
            >
              {getUserAvatarFallback(row.original.username ?? '')}
            </span>
            <span className='text-muted-foreground max-w-[9rem] truncate'>
              {row.original.username ?? '—'}
            </span>
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: t('Category'),
        cell: ({ row }) => {
          const category = TICKET_CATEGORIES[row.original.category]
          return (
            <span className='text-muted-foreground'>
              {category ? t(category.labelKey) : '—'}
            </span>
          )
        },
      },
      {
        accessorKey: 'priority',
        header: t('Priority'),
        cell: ({ row }) => {
          const priority = TICKET_PRIORITIES[row.original.priority]
          return priority ? (
            <StatusBadge
              label={t(priority.labelKey)}
              variant={priority.variant}
              size='sm'
              showDot={false}
              copyable={false}
            />
          ) : null
        },
      },
      {
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => {
          const status = TICKET_STATUSES[row.original.status]
          return status ? (
            <StatusBadge
              label={t(status.labelKey)}
              variant={status.variant}
              showDot
              copyable={false}
            />
          ) : null
        },
      },
      {
        accessorKey: 'last_reply_at',
        header: t('Last Reply'),
        cell: ({ row }) => (
          <span className='text-muted-foreground whitespace-nowrap tabular-nums'>
            {formatTicketTime(row.original.last_reply_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableHiding: false,
        cell: ({ row }) => (
          <Button
            type='button'
            variant='link'
            size='sm'
            className='text-primary h-auto p-0 font-normal'
            onClick={() => onView(row.original)}
          >
            {t('Details')}
          </Button>
        ),
      },
    ],
    [t, onView]
  )
}

function TicketsList() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const openTicket = useCallback(
    (ticket: Ticket) =>
      navigate({
        to: '/tickets/$ticketId',
        params: { ticketId: String(ticket.id) },
      }),
    [navigate]
  )
  const columns = useTicketColumns(openTicket)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: LIST_PAGE_SIZE,
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ticketsQueryKeys.list('admin', {
      list: true,
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    queryFn: async () => {
      const res = await adminListTickets({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      return res.data
    },
    placeholderData: (prev) => prev,
  })

  const tickets = data?.items ?? []
  const total = data?.total ?? 0

  const table = useReactTable({
    data: tickets,
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
      emptyTitle={t('No tickets')}
      skeletonKeyPrefix='admin-tickets-skeleton'
      tableClassName='overflow-x-auto [&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]'
      tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground [&_th]:font-medium'
    />
  )
}
