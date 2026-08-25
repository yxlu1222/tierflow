/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import { FIXED_THEME_PRESET, FIXED_THEME_RADIUS } from '@/lib/fixed-theme'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import type { TimeGranularity } from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'
import { processChartData } from '@/features/dashboard/lib'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { ConsoleCard } from '../overview/console-card'

interface UsageTrendCardProps {
  data: QuotaDataItem[]
  loading?: boolean
  isEmpty?: boolean
  timeGranularity: TimeGranularity
}

/**
 * Request-count trend for the appliance usage page. Monetary quota data stays
 * out of this view; the finance dashboard remains the dedicated cost surface.
 */
export function UsageTrendCard(props: UsageTrendCardProps) {
  const { t } = useTranslation()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${FIXED_THEME_PRESET}:${FIXED_THEME_RADIUS}`
  )
  const chartData = useMemo(
    () =>
      processChartData(
        props.loading ? [] : props.data,
        props.timeGranularity,
        t,
        FIXED_THEME_PRESET,
        chartRadius
      ),
    [props.data, props.loading, props.timeGranularity, t, chartRadius]
  )
  const spec = useMemo(
    () => ({
      ...chartData.spec_model_line,
      title: { visible: false },
      background: 'transparent',
      animation: false,
    }),
    [chartData.spec_model_line]
  )

  return (
    <ConsoleCard
      title={t('Requests over time')}
      caption={`${t('Total Requests')}: ${chartData.totalCountDisplay}`}
      className='h-full min-w-0'
      loading={props.loading}
      empty={props.isEmpty}
      emptyMessage={t('No data available')}
      contentHeight='300px'
    >
      <div className='h-[300px] min-w-0 overflow-hidden'>
        <VChart
          key={`usage-trend-${props.data.length}-${props.timeGranularity}`}
          spec={spec}
          option={VCHART_OPTION}
        />
      </div>
    </ConsoleCard>
  )
}
