/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { ConsoleCard } from '../overview/console-card'

export interface RankedUser {
  username: string
  quota: number
}

interface UserRankingCardProps {
  users: RankedUser[]
  total: number
  loading?: boolean
  isEmpty?: boolean
}

// Teal ramp (darkest → lightest) reused from the Console `.dash-console` scope,
// so the top spender reads strongest and the bars stay on-palette.
const BAR_COLORS = [
  'var(--ov-c1)',
  'var(--ov-c2)',
  'var(--ov-c3)',
  'var(--ov-c4)',
  'var(--ov-c5)',
] as const

/**
 * 用户消费排行 — a custom Console-style ranked list (rank · username · share
 * bar · mono value) rather than a VChart, matching the redesign's hairline,
 * tabular-number aesthetic and sidestepping chart-label overflow.
 */
export function UserRankingCard(props: UserRankingCardProps) {
  const { t } = useTranslation()
  const maxQuota = props.users.reduce((max, u) => Math.max(max, u.quota), 0)

  return (
    <ConsoleCard
      title={t('User Consumption Ranking')}
      caption={`${t('Total:')} ${formatQuota(props.total)}`}
      loading={props.loading}
      empty={props.isEmpty}
      emptyMessage={t('No data available')}
      contentHeight='300px'
    >
      <div className='flex flex-col gap-[11px]'>
        {props.users.map((user, index) => {
          const width = maxQuota > 0 ? (user.quota / maxQuota) * 100 : 0
          return (
            <div key={user.username} className='flex items-center gap-3'>
              <span className='text-muted-foreground w-4 shrink-0 text-right font-mono text-[11px] tabular-nums'>
                {index + 1}
              </span>
              <div className='min-w-0 flex-1'>
                <div className='mb-[6px] flex items-baseline justify-between gap-2'>
                  <span className='text-foreground/85 min-w-0 truncate font-mono text-[12.5px]'>
                    {user.username}
                  </span>
                  <span className='text-foreground shrink-0 font-mono text-[12.5px] font-semibold tabular-nums'>
                    {formatQuota(user.quota)}
                  </span>
                </div>
                <div className='bg-muted/60 h-1.5 overflow-hidden rounded-[4px]'>
                  <span
                    className='block h-full rounded-[4px] transition-[width] duration-500'
                    style={{
                      width: `${width}%`,
                      background: BAR_COLORS[index % BAR_COLORS.length],
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </ConsoleCard>
  )
}
