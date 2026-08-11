/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ModelHealthState, ProviderHealthState } from './types'

// tone drives the dot colour, the soft badge background, and the accent text so
// a state reads the same way everywhere on the route-monitor pages.
export type Tone = 'ok' | 'warn' | 'bad'

export type StateMeta = {
  labelKey: string
  tone: Tone
}

export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
}

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-emerald-600',
  warn: 'text-amber-600',
  bad: 'text-red-600',
}

export const TONE_BADGE: Record<Tone, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  bad: 'border-red-200 bg-red-50 text-red-700',
}

export const MODEL_STATE_META: Record<ModelHealthState, StateMeta> = {
  healthy: { labelKey: 'Healthy', tone: 'ok' },
  degraded: { labelKey: 'Degraded', tone: 'warn' },
  down: { labelKey: 'Down', tone: 'bad' },
}

export const PROVIDER_STATE_META: Record<ProviderHealthState, StateMeta> = {
  healthy: { labelKey: 'Healthy', tone: 'ok' },
  probing: { labelKey: 'Probing', tone: 'warn' },
  degraded: { labelKey: 'Degraded', tone: 'warn' },
  cooling: { labelKey: 'Cooling down', tone: 'bad' },
}

// StatusDot is a small pulsing dot; the pulse only animates for non-ok tones so
// a healthy board stays visually quiet.
export function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span className='relative flex size-2.5 shrink-0'>
      {tone !== 'ok' && (
        <span
          className={cn(
            'absolute inline-flex size-full animate-ping rounded-full opacity-60',
            TONE_DOT[tone]
          )}
        />
      )}
      <span
        className={cn('relative inline-flex size-2.5 rounded-full', TONE_DOT[tone])}
      />
    </span>
  )
}

export function StateBadge({ meta }: { meta: StateMeta }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_BADGE[meta.tone]
      )}
    >
      <StatusDot tone={meta.tone} />
      {t(meta.labelKey)}
    </span>
  )
}
