/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { VChart } from '@visactor/react-vchart'
import { AreaChart, BarChart3, WalletCards } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FIXED_THEME_PRESET, FIXED_THEME_RADIUS } from '@/lib/fixed-theme'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import type { TimeGranularity } from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'
import {
  CONSUMPTION_DISTRIBUTION_CHART_OPTIONS,
  DEFAULT_TIME_GRANULARITY,
} from '@/features/dashboard/constants'
import { processChartData } from '@/features/dashboard/lib'
import type {
  ConsumptionDistributionChartType,
  QuotaDataItem,
} from '@/features/dashboard/types'

interface ConsumptionDistributionChartProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  // view1（调用方案）传 true：按小写归一化合并别名大小写变体；view2 不传，保持原样。
  normalizeModelKey?: boolean
  /** Embedded mode: drop the own card frame/title so it can nest inside a
   *  ConsoleCard (used by the redesigned Overview). Keeps the inner toggle. */
  embedded?: boolean
  /** 锁定图表类型并隐藏 bar/area 切换器(全站用量面板只用 bar)。 */
  lockedChartType?: ConsumptionDistributionChartType
}

const CHART_TYPE_ICONS: Record<
  ConsumptionDistributionChartType,
  typeof BarChart3
> = {
  bar: BarChart3,
  area: AreaChart,
}

export function ConsumptionDistributionChart(
  props: ConsumptionDistributionChartProps
) {
  const { t } = useTranslation()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${FIXED_THEME_PRESET}:${FIXED_THEME_RADIUS}`
  )
  const [chartType, setChartType] = useState<ConsumptionDistributionChartType>('bar')
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

  const chartData = useMemo(
    () =>
      processChartData(
        props.loading ? [] : props.data,
        timeGranularity,
        t,
        FIXED_THEME_PRESET,
        chartRadius,
        props.normalizeModelKey
      ),
    [
      props.data,
      props.loading,
      timeGranularity,
      t,
      FIXED_THEME_PRESET,
      chartRadius,
      props.normalizeModelKey,
    ]
  )
  const effectiveType = props.lockedChartType ?? chartType
  const spec =
    effectiveType === 'bar' ? chartData.spec_line : chartData.spec_area
  const specType = typeof spec?.type === 'string' ? spec.type : effectiveType
  const chartKey = [
    effectiveType,
    specType,
    props.loading ? 'loading' : 'ready',
    props.data.length,
    FIXED_THEME_PRESET,
  ].join('-')

  const toggle = (
    <div className='bg-muted/60 inline-flex h-6 w-full overflow-x-auto rounded-md border p-0.5 sm:h-7 sm:w-auto sm:rounded-lg'>
      {CONSUMPTION_DISTRIBUTION_CHART_OPTIONS.map((item) => {
        const Icon = CHART_TYPE_ICONS[item.value]
        return (
          <button
            key={item.value}
            type='button'
            onClick={() => setChartType(item.value)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors sm:px-3 sm:text-xs ${
              chartType === item.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className='size-3.5' />
            {t(item.labelKey)}
          </button>
        )
      })}
    </div>
  )

  const chart = (
    <div
      className={
        props.embedded ? 'min-h-0 flex-1' : 'h-[300px] p-1.5 sm:h-96 sm:p-2'
      }
    >
      {spec && (
        <VChart
          key={chartKey}
          spec={{
            ...spec,
            theme: 'light',
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      )}
    </div>
  )

  if (props.embedded) {
    return (
      <div className='flex h-full flex-col'>
        <div className='mb-2.5 flex shrink-0 items-center gap-2'>
          <span className='text-muted-foreground text-xs'>
            {t('Total:')} {chartData.totalQuotaDisplay}
          </span>
          {!props.lockedChartType && <div className='ml-auto'>{toggle}</div>}
        </div>
        {chart}
      </div>
    )
  }

  return (
    <div className='bg-card border-border/60 overflow-hidden rounded-xl border shadow-sm transition-shadow hover:shadow-md'>
      <div className='flex w-full flex-col gap-1.5 border-b px-3 py-2 sm:gap-2 sm:px-4 sm:py-2.5 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <WalletCards className='text-muted-foreground/60 size-3.5' />
          <div className='text-[13px] font-semibold tracking-tight sm:text-sm'>
            {t('Quota Distribution')}
          </div>
          <span className='text-muted-foreground text-[11px] sm:text-xs'>
            {t('Total:')} {chartData.totalQuotaDisplay}
          </span>
        </div>
        {toggle}
      </div>
      {chart}
    </div>
  )
}
