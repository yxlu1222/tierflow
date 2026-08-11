/*
Copyright (C) 2023-2026 TierFlow
*/
import { cn } from '@/lib/utils'

interface MiniSparklineProps {
  values: number[]
  /** CSS color (accepts `var(--ov-accent)` etc.). */
  color?: string
  className?: string
}

/**
 * Tiny inline sparkline used inside the Overview KPI cells — a single smoothed
 * line with an emphasized endpoint. Falls back to a dashed baseline when there
 * is no data (empty/loading), keeping the cell height stable.
 */
export function MiniSparkline(props: MiniSparklineProps) {
  const { values, color = 'var(--ov-accent)', className } = props

  if (!values || values.length < 2) {
    return (
      <svg
        viewBox='0 0 100 32'
        preserveAspectRatio='none'
        className={cn('h-full w-full', className)}
        aria-hidden='true'
      >
        <line
          x1='3'
          y1='26'
          x2='97'
          y2='26'
          stroke='var(--border)'
          strokeWidth='1.4'
          strokeDasharray='3 3'
        />
      </svg>
    )
  }

  const width = 100
  const height = 32
  const pad = 3
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - 2 * pad)
    const y = pad + (1 - (value - min) / range) * (height - 2 * pad)
    return [x, y] as const
  })
  const polyline = points
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ')
  const last = points[points.length - 1]

  return (
    <svg
      viewBox='0 0 100 32'
      preserveAspectRatio='none'
      className={cn('h-full w-full', className)}
      aria-hidden='true'
    >
      <polyline
        fill='none'
        stroke={color}
        strokeWidth='1.7'
        strokeLinecap='round'
        strokeLinejoin='round'
        points={polyline}
      />
      <circle
        cx={last[0].toFixed(2)}
        cy={last[1].toFixed(2)}
        r='2.1'
        fill={color}
      />
    </svg>
  )
}
