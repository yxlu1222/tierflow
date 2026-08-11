/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import { Receipt } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserWalletData } from '../types'

interface RechargeHeroProps {
  user: UserWalletData | null
  loading?: boolean
}

/**
 * Console-style gradient hero for the recharge page.
 *
 * Mirrors the treatment used on the Bills and API Keys pages: brand glow,
 * rounded-2xl card, uppercase micro-label + oversized figure on the left,
 * translucent stat tiles on the right. Where the Bills hero pushes users
 * *toward* recharge, this hero anchors them once they arrive — the balance
 * they are topping up is the primary figure, with a shortcut back to Bills.
 */
export function RechargeHero({ user, loading }: RechargeHeroProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <section className='bg-card relative overflow-hidden rounded-2xl border p-6 shadow-xs sm:p-7'>
      {/* Subtle brand glow, top-left — theme-aware via the primary token
          (same treatment as the Bills / API Keys heroes). */}
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
            {t('Current Balance')}
          </div>
          <div className='text-foreground mt-2 font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-5xl'>
            {loading ? (
              <Skeleton className='h-11 w-52' />
            ) : (
              formatQuota(user?.quota ?? 0)
            )}
          </div>
          <p className='text-muted-foreground mt-3 max-w-md text-sm leading-6'>
            {t(
              'Add funds below to keep your balance topped up. Choose a preset or enter a custom amount, then pick a payment method.'
            )}
          </p>
        </div>

        <div className='shrink-0'>
          <Button
            onClick={() => navigate({ to: '/billing' })}
            className='h-11 gap-2 rounded-full px-6 text-sm font-medium'
          >
            <Receipt className='size-4' />
            {t('View Bills')}
          </Button>
        </div>
      </div>
    </section>
  )
}
