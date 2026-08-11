/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import dayjs from '@/lib/dayjs'
import type { TimeGranularity } from '@/lib/time'
import { DateRangePicker } from '@/components/date-range-picker'
import { FinanceCharts } from './finance-charts'
import { FinanceDimensions } from './finance-dimensions'

/**
 * Pick the x-axis bucket from the selected span: hourly for short windows,
 * daily for medium, weekly for long — so the trend stays legible whether the
 * user looks at a day or a quarter.
 */
function granularityFor(startSec: number, endSec: number): TimeGranularity {
  const days = (endSec - startSec) / 86400
  if (days <= 2) return 'hour'
  if (days <= 60) return 'day'
  return 'week'
}

/**
 * Finance tab shell — self-contained like the Overview: owns the date range,
 * renders the shared range picker, derives the chart granularity from the span,
 * and feeds both the trend charts and the per-model/channel tables. Replaces
 * the old preferences + filter dialogs.
 */
export function FinanceDashboard() {
  // Default to the last 7 days; the picker lets the user choose any range.
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => {
    const now = dayjs()
    return {
      start: now.subtract(7, 'day').startOf('day').toDate(),
      end: now.toDate(),
    }
  })

  const startTimestamp = Math.floor(range.start.getTime() / 1000)
  const endTimestamp = Math.floor(range.end.getTime() / 1000)
  const granularity = granularityFor(startTimestamp, endTimestamp)

  return (
    <div className='dash-console flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <DateRangePicker
          start={range.start}
          end={range.end}
          onChange={setRange}
        />
      </div>

      <FinanceCharts
        startTimestamp={startTimestamp}
        endTimestamp={endTimestamp}
        granularity={granularity}
      />
      <FinanceDimensions
        startTimestamp={startTimestamp}
        endTimestamp={endTimestamp}
      />
    </div>
  )
}
