/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 全站用量分区(管理端)——「指定时间段内全站用了多少、实际打到哪些模型上」。
 *
 * 与另外两个管理端分区的分工:
 * - 用户分析:同样是全站数据,但按**用户**聚合(排行、人均),回答「谁在用」
 * - 财务:按模型看**钱**(收入/成本/毛利),回答「赚不赚」
 * - 这里:按**时间和模型**看调用量(请求数/token/消耗),回答「用了什么」
 *
 * 数据源是 /api/data(getUserQuotaDates 的 isAdmin 分支),与用户端 /usage 走的
 * /api/data/self 是两个端点 —— 所以这里自己取数,不复用 useOverviewData(那个
 * 已经收窄成用户自己的三个合计值)。
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { formatNumber, formatQuota } from '@/lib/format'
import type { TimeGranularity } from '@/lib/time'
import { DateRangePicker } from '@/components/date-range-picker'
import { getUserQuotaDates } from '@/features/dashboard/api'
import {
  buildQueryParams,
  calculateDashboardStats,
} from '@/features/dashboard/lib'
import { ConsoleKpiStrip, type ConsoleKpiCell } from '../console-kpi-strip'
import { ConsumptionCard } from './consumption-card'
import { ModelMixChart } from './model-mix-chart'
import { ModelUsageTable } from './model-usage-table'

/** 跨度 ≤ 2 天按小时分桶,更长按天 —— 与日志表的取舍一致。 */
function granularityFor(startSec: number, endSec: number): TimeGranularity {
  return (endSec - startSec) / 86400 <= 2 ? 'hour' : 'day'
}

export function SiteUsagePanel() {
  const { t } = useTranslation()

  // 默认近 7 天;管理端要查任意区间,所以这里保留完整的区间选择器
  const [range, setRange] = useState<{ start: Date; end: Date }>(() => {
    const end = dayjs()
    return { start: end.subtract(7, 'day').toDate(), end: end.toDate() }
  })

  const startTimestamp = Math.floor(range.start.getTime() / 1000)
  const endTimestamp = Math.floor(range.end.getTime() / 1000)
  const granularity = granularityFor(startTimestamp, endTimestamp)

  const { data, isLoading } = useQuery({
    queryKey: [
      'dashboard',
      'site-usage',
      startTimestamp,
      endTimestamp,
      granularity,
    ],
    queryFn: () =>
      getUserQuotaDates(
        buildQueryParams(
          { start_timestamp: startTimestamp, end_timestamp: endTimestamp },
          { time_granularity: granularity }
        ),
        // 全站口径
        true
      ),
    select: (res) => (res.success ? res.data : []),
    staleTime: 60_000,
  })

  const rows = useMemo(() => (isLoading ? [] : (data ?? [])), [data, isLoading])
  const isEmpty = !isLoading && rows.length === 0
  const totals = useMemo(() => calculateDashboardStats(rows), [rows])

  const kpiCells: ConsoleKpiCell[] = [
    {
      key: 'quota',
      label: t('Total Consumption'),
      value: formatQuota(totals.totalQuota),
      sub: t('Site-wide'),
      spark: [],
      sparkColor: 'var(--ov-bad)',
    },
    {
      key: 'tokens',
      label: t('Total Tokens'),
      value: formatNumber(totals.totalTokens),
      sub: t('Site-wide'),
      spark: [],
      sparkColor: 'var(--info)',
    },
    {
      key: 'requests',
      label: t('Requests'),
      value: formatNumber(totals.totalCount),
      sub: t('Site-wide'),
      spark: [],
      sparkColor: 'var(--ov-accent)',
    },
  ]

  return (
    <div className='dash-console flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <DateRangePicker
          start={range.start}
          end={range.end}
          onChange={setRange}
        />
      </div>

      <ConsoleKpiStrip cells={kpiCells} loading={isLoading} columns={3} />

      <div className='grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]'>
        <ConsumptionCard
          data={rows}
          loading={isLoading}
          timeGranularity={granularity}
        />
        <ModelMixChart data={rows} loading={isLoading} isEmpty={isEmpty} />
      </div>

      <ModelUsageTable data={rows} loading={isLoading} isEmpty={isEmpty} />
    </div>
  )
}
