/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import { Activity, BarChart3, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export interface BillingUser {
  quota?: number
  used_quota?: number
  request_count?: number
}

interface BillingHeroProps {
  user: BillingUser | null
  loading?: boolean
}

export function BillingHero({ user, loading }: BillingHeroProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const stats = [
    {
      label: t('Total Spent'),
      value: formatQuota(user?.used_quota ?? 0),
      icon: BarChart3,
    },
    {
      label: t('Total Requests'),
      value: (user?.request_count ?? 0).toLocaleString(),
      icon: Activity,
    },
  ]

  return (
    <section className='bg-card relative overflow-hidden rounded-2xl border p-6 shadow-xs sm:p-7'>
      {/* Subtle brand glow, top-left — theme-aware via the primary token
          (same treatment as the API Keys hero). */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at top left, color-mix(in srgb, var(--primary) 13%, transparent), transparent 42%)',
        }}
      />
      <div className='relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
        <div className='min-w-0'>
          <div className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
            {t('Account Balance')}
          </div>
          <div className='text-foreground mt-2 font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-5xl'>
            {loading ? (
              <Skeleton className='h-11 w-52' />
            ) : (
              formatQuota(user?.quota ?? 0)
            )}
          </div>
          <div className='mt-5'>
            <Button
              onClick={() => navigate({ to: '/recharge' })}
              className='h-11 gap-2 rounded-full px-6 text-sm font-medium'
            >
              <Plus className='size-4' />
              {t('Recharge')}
            </Button>
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2 xl:min-w-[300px]'>
          {stats.map((item) => (
            <div
              key={item.label}
              className='bg-background/70 rounded-lg border px-4 py-3 backdrop-blur'
            >
              <div className='flex items-center gap-2'>
                <item.icon className='text-muted-foreground/60 size-3.5 shrink-0' />
                <div className='text-muted-foreground truncate text-xs font-medium tracking-wider uppercase'>
                  {item.label}
                </div>
              </div>
              <div className='text-foreground mt-2 font-mono text-2xl font-semibold tracking-tight tabular-nums'>
                {loading ? <Skeleton className='h-7 w-24' /> : item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
