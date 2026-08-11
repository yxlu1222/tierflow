/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FIXED_THEME_PRESET } from '@/lib/fixed-theme'
import { formatNumber, formatQuota } from '@/lib/format'
import { getRollingDateRange, type TimeGranularity } from '@/lib/time'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getUserQuotaDataByUsers } from '@/features/dashboard/api'
import {
  TIME_GRANULARITY_OPTIONS,
  TIME_RANGE_PRESETS,
} from '@/features/dashboard/constants'
import {
  getDefaultDays,
  getSavedGranularity,
  saveGranularity,
  processUserChartData,
} from '@/features/dashboard/lib'
import { ConsoleChartCard } from '../console-chart-card'
import { ConsoleKpiStrip, type ConsoleKpiCell } from '../console-kpi-strip'
import { PerformanceHealthPanel } from './performance-health-panel'
import { UserRankingCard } from './user-ranking-card'

const TOP_USER_LIMIT_OPTIONS = [5, 10, 20, 50]

export function UserCharts() {
  const { t } = useTranslation()

  const [timeGranularity, setTimeGranularity] = useState<TimeGranularity>(() =>
    getSavedGranularity()
  )
  const [selectedRange, setSelectedRange] = useState<number>(() =>
    getDefaultDays(timeGranularity)
  )
  const [topUserLimit, setTopUserLimit] = useState(10)
  const [timeRange, setTimeRange] = useState(() => {
    const days = getDefaultDays(timeGranularity)
    const { start, end } = getRollingDateRange(days)
    return {
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    }
  })

  const handleRangeChange = useCallback((days: number) => {
    setSelectedRange(days)
    const { start, end } = getRollingDateRange(days)
    setTimeRange({
      start_timestamp: Math.floor(start.getTime() / 1000),
      end_timestamp: Math.floor(end.getTime() / 1000),
    })
  }, [])

  const handleGranularityChange = useCallback(
    (g: TimeGranularity) => {
      setTimeGranularity(g)
      saveGranularity(g)
      const days = getDefaultDays(g)
      if (days !== selectedRange) {
        handleRangeChange(days)
      }
    },
    [selectedRange, handleRangeChange]
  )

  const { data: userData, isLoading } = useQuery({
    queryKey: ['dashboard', 'user-quota', timeRange],
    queryFn: () => getUserQuotaDataByUsers(timeRange),
    select: (res) => (res.success ? res.data : []),
    staleTime: 60_000,
  })

  // Per-user totals + per-time-bucket series, derived once and shared by the
  // KPI strip and the ranking card.
  const stats = useMemo(() => {
    const rows = isLoading ? [] : (userData ?? [])
    const byUser = new Map<string, number>()
    const byBucket = new Map<number, { spend: number; count: number }>()

    for (const item of rows) {
      const user = item.username || 'unknown'
      byUser.set(user, (byUser.get(user) || 0) + (Number(item.quota) || 0))
      const bucket = Number(item.created_at) || 0
      const current = byBucket.get(bucket) ?? { spend: 0, count: 0 }
      current.spend += Number(item.quota) || 0
      current.count += Number(item.count) || 0
      byBucket.set(bucket, current)
    }

    // A quota_data row only proves a request happened — free-model traffic
    // records quota 0. Everything on this tab reads as "consumption", so users
    // who spent nothing are dropped here rather than filtered at each consumer.
    const ranked = Array.from(byUser.entries())
      .filter(([, quota]) => quota > 0)
      .map(([username, quota]) => ({ username, quota }))
      .sort((a, b) => b.quota - a.quota)
    const totalSpend = ranked.reduce((sum, u) => sum + u.quota, 0)
    const activeUsers = ranked.length
    const buckets = Array.from(byBucket.keys()).sort((a, b) => a - b)

    return {
      ranked,
      totalSpend,
      activeUsers,
      avgSpend: activeUsers > 0 ? totalSpend / activeUsers : 0,
      topShare:
        totalSpend > 0 && ranked.length > 0
          ? (ranked[0].quota / totalSpend) * 100
          : 0,
      topUser: ranked[0]?.username ?? '',
      spendSeries: buckets.map((b) => byBucket.get(b)?.spend ?? 0),
      countSeries: buckets.map((b) => byBucket.get(b)?.count ?? 0),
    }
  }, [userData, isLoading])

  const trendSpec = useMemo(
    () =>
      processUserChartData(
        isLoading ? [] : (userData ?? []),
        timeGranularity,
        t,
        topUserLimit,
        FIXED_THEME_PRESET
      ).spec_user_trend,
    [userData, isLoading, timeGranularity, t, topUserLimit]
  )

  const isEmpty = !isLoading && stats.ranked.length === 0

  const kpiCells: ConsoleKpiCell[] = [
    {
      key: 'active-users',
      label: t('Active users'),
      value: formatNumber(stats.activeUsers),
      sub: t('With consumption'),
      spark: stats.countSeries,
      sparkColor: 'var(--ov-accent)',
    },
    {
      key: 'total-spend',
      label: t('Total consumption'),
      value: formatQuota(stats.totalSpend),
      sub: t('Selected range'),
      spark: stats.spendSeries,
      sparkColor: 'var(--ov-bad)',
    },
    {
      key: 'avg-spend',
      label: t('Average per user'),
      value: formatQuota(stats.avgSpend),
      sub: t('Active users only'),
      spark: stats.spendSeries,
      sparkColor: 'var(--info)',
    },
    {
      key: 'top-share',
      label: t('Top user share'),
      value: stats.topShare.toFixed(1),
      unit: '%',
      valueClass: 'text-[var(--ov-good)]',
      sub: stats.topUser ? (
        <span className='font-mono'>{stats.topUser}</span>
      ) : (
        '—'
      ),
      spark: [],
      sparkColor: 'var(--ov-good)',
    },
  ]

  return (
    <div className='dash-console flex flex-col gap-4'>
      {/* ── Controls: range / granularity / top-N ─────────────────────── */}
      <div className='flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2'>
        <Tabs
          value={String(selectedRange)}
          onValueChange={(value) => handleRangeChange(Number(value))}
          className='shrink-0'
        >
          <TabsList>
            {TIME_RANGE_PRESETS.map((preset) => (
              <TabsTrigger
                key={preset.days}
                value={String(preset.days)}
                className='px-2.5 text-xs'
              >
                {t(preset.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Tabs
          value={timeGranularity}
          onValueChange={(value) =>
            handleGranularityChange(value as TimeGranularity)
          }
          className='shrink-0'
        >
          <TabsList>
            {TIME_GRANULARITY_OPTIONS.map((opt) => (
              <TabsTrigger
                key={opt.value}
                value={opt.value}
                className='px-2.5 text-xs'
              >
                {t(opt.label)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Tabs
          value={String(topUserLimit)}
          onValueChange={(value) => setTopUserLimit(Number(value))}
          className='shrink-0'
        >
          <TabsList>
            <span className='text-muted-foreground px-2 text-xs font-medium whitespace-nowrap'>
              {t('Top Users')}
            </span>
            {TOP_USER_LIMIT_OPTIONS.map((limit) => (
              <TabsTrigger
                key={limit}
                value={String(limit)}
                className='px-2.5 text-xs'
              >
                {t('Top {{count}}', { count: limit })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {isLoading && (
          <Loader2 className='text-muted-foreground size-4 animate-spin' />
        )}
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────── */}
      <ConsoleKpiStrip cells={kpiCells} loading={isLoading} />

      {/* ── Ranking + trend ───────────────────────────────────────────── */}
      <div className='grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2'>
        <UserRankingCard
          users={stats.ranked.slice(0, topUserLimit)}
          total={stats.totalSpend}
          loading={isLoading}
          isEmpty={isEmpty}
        />
        <ConsoleChartCard
          title={t('User Consumption Trend')}
          spec={trendSpec}
          chartKey={`user-trend-${userData?.length ?? 0}`}
          loading={isLoading}
          isEmpty={isEmpty}
          specOverrides={{
            title: { visible: false },
            legends: { visible: true, orient: 'bottom', selectMode: 'single' },
          }}
        />
      </div>

      {/* ── 平台性能健康(全站采样,仅管理端可见) ──────────────────── */}
      <PerformanceHealthPanel />
    </div>
  )
}
