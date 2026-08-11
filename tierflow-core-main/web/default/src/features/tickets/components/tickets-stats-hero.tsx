/*
Copyright (C) 2023-2026 TierFlow
*/
import { CircleCheckBig, Clock, Inbox } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { TICKET_STATUS } from '../constants'
import type { TicketStats } from '../types'

interface TicketsStatsHeroProps {
  stats?: TicketStats
  isLoading?: boolean
}

type Tone = 'primary' | 'warning' | 'success'

const toneClasses: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  warning: 'bg-warning/12 text-warning',
  success: 'bg-success/12 text-success',
}

/**
 * 看板/列表之上的总体概览：工单总数 / 待处理数 / 已处理数。
 * 待处理 = open；已处理 = resolved。
 */
export function TicketsStatsHero({ stats, isLoading }: TicketsStatsHeroProps) {
  const { t } = useTranslation()

  const pending = stats?.[TICKET_STATUS.OPEN] ?? 0
  const processed = stats?.[TICKET_STATUS.RESOLVED] ?? 0
  const total = pending + processed

  const cards: {
    key: string
    label: string
    value: number
    tone: Tone
    icon: typeof Inbox
  }[] = [
    {
      key: 'total',
      label: t('Total Tickets'),
      value: total,
      tone: 'primary',
      icon: Inbox,
    },
    {
      key: 'pending',
      label: t('Pending Tickets'),
      value: pending,
      tone: 'warning',
      icon: Clock,
    },
    {
      key: 'processed',
      label: t('Completed Tickets'),
      value: processed,
      tone: 'success',
      icon: CircleCheckBig,
    },
  ]

  return (
    <div className='grid grid-cols-3 gap-2.5 sm:gap-3'>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <div
            key={card.key}
            className='ring-foreground/10 bg-card flex items-center gap-3 rounded-2xl p-3.5 ring-1 sm:gap-4 sm:p-5'
          >
            <div
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-xl sm:size-12',
                toneClasses[card.tone]
              )}
            >
              <Icon className='size-5' />
            </div>
            <div className='min-w-0'>
              <div className='text-muted-foreground truncate text-xs font-medium sm:text-sm'>
                {card.label}
              </div>
              {isLoading ? (
                <Skeleton className='mt-1.5 h-7 w-12 rounded' />
              ) : (
                <div className='mt-0.5 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl'>
                  {card.value}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
