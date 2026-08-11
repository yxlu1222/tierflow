/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { enUS, zhCN } from 'date-fns/locale'
import { ArrowRight, CalendarDays } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface DateRangePickerProps {
  start: Date
  end: Date
  onChange: (range: { start: Date; end: Date }) => void
  className?: string
}

const fmt = (date: Date) => dayjs(date).format('YYYY-MM-DD')

/**
 * Shared date-range field: a two-month range calendar (react-day-picker) in a
 * popover with Today / 7-day / 30-day presets, built from the app's own
 * Calendar/Popover so it stays on the Base UI + Tailwind design system. Used by
 * both the dashboard overview and the logs filter toolbar.
 *
 * The accent color reads `--ov-accent` when rendered inside the dashboard's
 * `.dash-console` scope and falls back to the app-wide `--ring` token
 * elsewhere, so it looks native on every page.
 */
export function DateRangePicker({
  start,
  end,
  onChange,
  className,
}: DateRangePickerProps) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>()

  const locale = i18n.language?.toLowerCase().startsWith('zh') ? zhCN : enUS

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft({ from: start, to: end })
    setOpen(next)
  }

  const commit = (range: DateRange | undefined) => {
    setDraft(range)
    if (range?.from && range?.to) {
      onChange({
        start: dayjs(range.from).startOf('day').toDate(),
        end: dayjs(range.to).endOf('day').toDate(),
      })
      setOpen(false)
    }
  }

  const applyPreset = (days: number) => {
    const now = dayjs()
    onChange({
      start: now
        .subtract(days - 1, 'day')
        .startOf('day')
        .toDate(),
      end: now.endOf('day').toDate(),
    })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type='button'
            aria-label={t('Date Range')}
            className={cn(
              'bg-background text-foreground border-border inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:border-[var(--ov-accent,var(--ring))] data-[popup-open]:border-[var(--ov-accent,var(--ring))]',
              className
            )}
          />
        }
      >
        <span className='tabular-nums'>{fmt(start)}</span>
        <ArrowRight className='text-muted-foreground size-3.5 shrink-0' />
        <span className='tabular-nums'>{fmt(end)}</span>
        <CalendarDays className='text-muted-foreground ml-0.5 size-4 shrink-0' />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-auto p-2'>
        <Calendar
          mode='range'
          numberOfMonths={2}
          defaultMonth={start}
          selected={draft}
          onSelect={commit}
          locale={locale}
          autoFocus
        />
        <div className='flex flex-wrap gap-1.5 px-1 pt-2'>
          {[
            { label: t('Today'), days: 1 },
            { label: t('7 Days'), days: 7 },
            { label: t('30 Days'), days: 30 },
          ].map((preset) => (
            <Button
              key={preset.days}
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
