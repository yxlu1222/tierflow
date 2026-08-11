/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode } from 'react'
import { VChart } from '@visactor/react-vchart'
import { FIXED_THEME_PRESET } from '@/lib/fixed-theme'
import { VCHART_OPTION } from '@/lib/vchart'
import { ConsoleCard } from './overview/console-card'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VChartSpec = Record<string, any>

interface ConsoleChartCardProps {
  title: ReactNode
  caption?: ReactNode
  actions?: ReactNode
  spec: VChartSpec | null | undefined
  /** Extra remount key parts (e.g. data length, chart type). */
  chartKey: string
  loading?: boolean
  isEmpty?: boolean
  emptyMessage?: string
  /** Plot height (default "300px"). */
  height?: string
  /** Spec fields merged over `spec` — defaults hide the built-in title and move
   *  the legend below the plot, since ConsoleCard's header labels the chart. */
  specOverrides?: VChartSpec
}

const DEFAULT_OVERRIDES: VChartSpec = {
  title: { visible: false },
  legends: { visible: true, orient: 'bottom' },
}

/**
 * A VChart rendered inside the Console `ConsoleCard` frame. The app is
 * light-only, so charts render with VChart's built-in light theme directly.
 * Used by every dashboard tab that embeds a chart in a card (user trend,
 * finance trends, …).
 */
export function ConsoleChartCard(props: ConsoleChartCardProps) {
  const height = props.height ?? '300px'
  const chartKey = [props.chartKey, FIXED_THEME_PRESET].join('-')

  return (
    <ConsoleCard
      title={props.title}
      caption={props.caption}
      actions={props.actions}
      loading={props.loading}
      empty={props.isEmpty}
      emptyMessage={props.emptyMessage}
      contentHeight={height}
    >
      <div style={{ height }}>
        {props.spec && (
          <VChart
            key={chartKey}
            spec={{
              ...props.spec,
              ...(props.specOverrides ?? DEFAULT_OVERRIDES),
              theme: 'light',
              background: 'transparent',
            }}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </ConsoleCard>
  )
}
