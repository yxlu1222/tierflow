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
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DataTablePage } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import { listMyTickets } from './api'
import { CreateTicketDialog } from './components/create-ticket-dialog'
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from './constants'
import { formatTicketTime } from './lib/format'
import { ticketsQueryKeys } from './lib/query-keys'
import type { Ticket } from './types'

const PAGE_SIZE = 20

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
          <span className='text-foreground block max-w-[24rem] truncate'>
            {row.original.title}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: t('Category'),
        cell: ({ row }) => {
          const category = TICKET_CATEGORIES[row.original.category]
          return category ? t(category.labelKey) : '—'
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
              showDot={false}
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
        cell: ({ row }) => (
          <Button
            variant='link'
            size='sm'
            className='text-primary h-auto px-0 py-0 font-normal'
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

export function MyTickets() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const handleView = useCallback(
    (ticket: Ticket) =>
      navigate({
        to: '/tickets/$ticketId',
        params: { ticketId: String(ticket.id) },
      }),
    [navigate]
  )
  const columns = useTicketColumns(handleView)
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ticketsQueryKeys.list('self', {
      p: pagination.pageIndex + 1,
      page_size: pagination.pageSize,
    }),
    queryFn: async () => {
      const res = await listMyTickets({
        p: pagination.pageIndex + 1,
        page_size: pagination.pageSize,
      })
      return res.data
    },
    placeholderData: (previousData) => previousData,
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
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Ticket Records')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
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
            emptyTitle={t('No tickets yet')}
            emptyDescription={t(
              'Run into a problem? Open a ticket and our team will help you out.'
            )}
            emptyAction={
              <Button
                variant='outline'
                size='sm'
                onClick={() => setCreateOpen(true)}
              >
                <Plus className='size-4' />
                {t('New Ticket')}
              </Button>
            }
            skeletonKeyPrefix='my-tickets-skeleton'
            tableClassName='overflow-x-auto [&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px] [&_[data-slot=table]_th]:font-normal [&_[data-slot=table]_td]:font-normal [&_[data-slot=empty-title]]:!text-xl'
            tableHeaderClassName='bg-muted sticky top-0 z-10 [&_th]:text-foreground'
          />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <CreateTicketDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
