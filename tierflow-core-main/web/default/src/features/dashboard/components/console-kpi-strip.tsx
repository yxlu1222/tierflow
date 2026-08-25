/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { MiniSparkline } from './overview/mini-sparkline'

export interface ConsoleKpiCell {
  key: string
  label: string
  value: string
  unit?: string
  sub: ReactNode
  spark: number[]
  sparkColor: string
  valueClass?: string
}

// Static column classes so Tailwind keeps them (no dynamic `lg:grid-cols-${n}`).
const LG_COLS: Record<number, string> = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
}

interface ConsoleKpiStripProps {
  cells: ConsoleKpiCell[]
  loading?: boolean
  /** Number of columns at the `lg` breakpoint (default 4). */
  columns?: number
}

/**
 * Console-scheme KPI strip shared across dashboard tabs — hairline-divided
 * cells, oversized mono tabular values and a mini sparkline tucked in the
 * bottom-right corner. Two columns on small screens, `columns` at `lg`.
 */
export function ConsoleKpiStrip(props: ConsoleKpiStripProps) {
  const lgCols = LG_COLS[props.columns ?? 4] ?? LG_COLS[4]

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-[14px] bg-[#d1d5db]',
        lgCols
      )}
    >
      {props.cells.map((cell) => (
        <div
          key={cell.key}
          className='relative min-h-[96px] bg-white pt-[15px] pr-[17px] pb-[13px] pl-[17px]'
        >
          <div className='text-muted-foreground text-[11px] font-semibold tracking-[0.09em] uppercase'>
            {cell.label}
          </div>
          {props.loading ? (
            <>
              <Skeleton className='mt-[9px] h-[26px] w-24' />
              <Skeleton className='mt-[6px] h-3.5 w-28' />
            </>
          ) : (
            <>
              <div
                className={cn(
                  'mt-[9px] font-mono text-[26px] leading-none font-semibold tracking-tight tabular-nums',
                  cell.valueClass ?? 'text-foreground'
                )}
              >
                {cell.value}
                {cell.unit && (
                  <span className='text-muted-foreground ml-0.5 text-sm font-medium'>
                    {cell.unit}
                  </span>
                )}
              </div>
              <div className='text-muted-foreground mt-[6px] truncate text-xs'>
                {cell.sub}
              </div>
            </>
          )}
          <div className='pointer-events-none absolute right-[14px] bottom-[12px] h-[26px] w-[64px] sm:w-[78px]'>
            <MiniSparkline values={cell.spark} color={cell.sparkColor} />
          </div>
        </div>
      ))}
    </div>
  )
}
