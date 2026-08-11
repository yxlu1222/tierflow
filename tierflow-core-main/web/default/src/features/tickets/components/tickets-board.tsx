/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import {
  adminGetTicketStats,
  adminListTickets,
  adminUpdateTicket,
} from '../api'
import {
  TICKET_BOARD_COLUMNS,
  TICKET_CATEGORIES,
  TICKET_MESSAGES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketStatus,
} from '../constants'
import { formatTicketTime } from '../lib/format'
import { ticketsQueryKeys } from '../lib/query-keys'
import type { Ticket } from '../types'

export function TicketsBoard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<TicketStatus | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ticketsQueryKeys.list('admin', { board: true }),
    queryFn: async () => {
      const res = await adminListTickets({ page_size: 100 })
      return res.data
    },
  })

  // 列头计数走 stats 接口，得到不受分页上限影响的真实总数。
  const { data: stats } = useQuery({
    queryKey: ticketsQueryKeys.stats(),
    queryFn: async () => {
      const res = await adminGetTicketStats()
      return res.data
    },
  })

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TicketStatus }) =>
      adminUpdateTicket(id, { status }),
    onSuccess: (res) => {
      if (!res.success) return
      toast.success(t(TICKET_MESSAGES.STATUS_UPDATED))
      queryClient.invalidateQueries({ queryKey: ticketsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ticketsQueryKeys.stats() })
    },
  })

  const grouped = useMemo(() => {
    const map: Record<string, Ticket[]> = {}
    TICKET_BOARD_COLUMNS.forEach((s) => (map[s] = []))
    ;(data?.items ?? []).forEach((tk) => {
      if (map[tk.status]) map[tk.status].push(tk)
    })
    return map
  }, [data])

  const handleDrop = (status: TicketStatus) => {
    setDragOver(null)
    const id = dragId
    setDragId(null)
    if (id == null) return
    const current = (data?.items ?? []).find((x) => x.id === id)
    if (!current || current.status === status) return
    moveMutation.mutate({ id, status })
  }

  if (isLoading) {
    return (
      <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
        {TICKET_BOARD_COLUMNS.map((s) => (
          <Skeleton key={s} className='h-[420px] w-full rounded-xl' />
        ))}
      </div>
    )
  }

  return (
    <div className='grid grid-cols-1 gap-3 md:grid-cols-2'>
      {TICKET_BOARD_COLUMNS.map((status) => {
        const meta = TICKET_STATUSES[status]
        const items = grouped[status] ?? []
        const count = stats?.[status] ?? items.length
        return (
          <div
            key={status}
            className={cn(
              'flex min-h-[240px] flex-col gap-2 rounded-xl p-2 transition-colors',
              dragOver === status
                ? 'bg-muted ring-primary/40 ring-1'
                : 'bg-muted/40'
            )}
            onDragOver={(e) => {
              e.preventDefault()
              if (dragOver !== status) setDragOver(status)
            }}
            onDragLeave={(e) => {
              // 仅当离开列容器本身时清除
              if (e.currentTarget === e.target) setDragOver(null)
            }}
            onDrop={() => handleDrop(status)}
          >
            <div className='flex items-center gap-2 px-1.5 py-1'>
              <StatusBadge
                label={t(meta.labelKey)}
                variant={meta.variant}
                showDot
                copyable={false}
              />
              <span className='text-muted-foreground ms-auto text-xs font-semibold tabular-nums'>
                {count}
              </span>
            </div>

            <div className='flex flex-col gap-2'>
              {items.map((ticket) => (
                <BoardCard
                  key={ticket.id}
                  ticket={ticket}
                  dragging={dragId === ticket.id}
                  onDragStart={() => setDragId(ticket.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setDragOver(null)
                  }}
                  onClick={() =>
                    navigate({
                      to: '/tickets/$ticketId',
                      params: { ticketId: String(ticket.id) },
                    })
                  }
                />
              ))}
              {items.length === 0 && (
                <div className='text-muted-foreground/60 rounded-lg py-6 text-center text-xs'>
                  {t('No tickets')}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface BoardCardProps {
  ticket: Ticket
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onClick: () => void
}

function BoardCard({
  ticket,
  dragging,
  onDragStart,
  onDragEnd,
  onClick,
}: BoardCardProps) {
  const { t } = useTranslation()
  const priority = TICKET_PRIORITIES[ticket.priority]
  const category = TICKET_CATEGORIES[ticket.category]

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      role='button'
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick()
      }}
      className={cn(
        'bg-background ring-foreground/10 flex cursor-pointer flex-col gap-2 rounded-xl p-3 ring-1 transition',
        'hover:ring-foreground/20 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        dragging && 'opacity-50'
      )}
    >
      <div className='text-muted-foreground flex items-center gap-2 text-[11px]'>
        {category && (
          <span className='bg-muted rounded-full px-2 py-0.5 font-medium'>
            {t(category.labelKey)}
          </span>
        )}
        <span className='ms-auto tabular-nums'>{ticket.ticket_no}</span>
      </div>
      <div className='line-clamp-2 text-[13px] font-medium'>{ticket.title}</div>
      <div className='flex items-center gap-2'>
        {priority && (
          <StatusBadge
            label={t(priority.labelKey)}
            variant={priority.variant}
            size='sm'
            copyable={false}
          />
        )}
        <span className='text-muted-foreground text-[11px]'>
          {formatTicketTime(ticket.last_reply_at)}
        </span>
        <span
          className='border-border ms-auto flex size-6 items-center justify-center rounded-full border text-[10px] font-semibold'
          style={getUserAvatarStyle(ticket.username)}
          title={ticket.username}
        >
          {getUserAvatarFallback(ticket.username ?? '')}
        </span>
      </div>
    </div>
  )
}
