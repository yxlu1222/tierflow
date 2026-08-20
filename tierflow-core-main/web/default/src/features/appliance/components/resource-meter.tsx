/*
Copyright (C) 2023-2026 TierFlow
*/
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { clampPercent } from '../lib'

interface ResourceMeterProps {
  icon: LucideIcon
  label: string
  value: number
  detail: string
  accent?: 'blue' | 'indigo' | 'emerald' | 'amber'
}

const accents = {
  blue: 'bg-blue-50 text-blue-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-700',
}

export function ResourceMeter(props: ResourceMeterProps) {
  const Icon = props.icon
  const value = clampPercent(props.value)

  return (
    <div className='min-w-0 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_28px_rgba(15,23,42,0.035)]'>
      <div className='flex min-w-0 items-start justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <span
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl',
              accents[props.accent ?? 'blue']
            )}
          >
            <Icon className='size-5' />
          </span>
          <div className='min-w-0'>
            <p className='text-base font-semibold text-slate-900'>
              {props.label}
            </p>
            <p className='mt-1 text-sm leading-5 text-slate-500'>
              {props.detail}
            </p>
          </div>
        </div>
        <span className='shrink-0 font-mono text-3xl font-semibold tracking-tight text-slate-950 tabular-nums'>
          {value.toFixed(1)}%
        </span>
      </div>
      <Progress value={value} className='mt-4' />
    </div>
  )
}
