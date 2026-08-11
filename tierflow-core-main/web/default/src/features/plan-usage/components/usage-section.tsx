/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 用量区:调用量三连卡 + 趋势折线(双桶两条线) + 30 天热力图。
 *
 * 数据源 /api/data/self?billing_source=subscription(小时粒度,后端硬限 30 天
 * 跨度)。口径:**仅套餐扣费**(quota_data 已带 billing_source/subscription_bucket
 * 维度,见 usedata.go);按量付费(钱包)的调用在用量信息页(/usage)展示,两页
 * 互补不重叠。趋势图按 premium/basic 桶拆成两条线,热力图侧栏分别给出高级额度
 * 消耗(quota)与基础 token 消耗(token 数) —— 两桶量纲不同,绝不能加总成一个数。
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { getUserQuotaDates } from '@/features/dashboard/api'
import { useNowSeconds } from '../hooks/use-now-seconds'
import { HeatmapLegend, UsageHeatmap, type HeatmapDay } from './usage-heatmap'

/** /api/data/self 的跨度上限是 2592000 秒;取 29 天 + 今日,留出安全余量 */
const WINDOW_DAYS = 30

function startOfDay(tsSec: number): number {
  const d = new Date(tsSec * 1000)
  d.setHours(0, 0, 0, 0)
  return Math.floor(d.getTime() / 1000)
}

interface StatTileProps {
  value: string
  label: string
  loading?: boolean
}

function StatTile({ value, label, loading }: StatTileProps) {
  return (
    <div className='bg-card rounded-2xl border p-5'>
      {loading ? (
        <Skeleton className='h-8 w-20' />
      ) : (
        <div className='text-2xl font-semibold tracking-tight tabular-nums'>
          {value}
        </div>
      )}
      <div className='text-muted-foreground mt-1 text-sm'>{label}</div>
    </div>
  )
}

export function UsageSection() {
  const { t, i18n } = useTranslation()
  const [range, setRange] = useState<7 | 30>(7)

  // 查询窗口固定拉满 30 天,7/30 天切换只在前端裁剪,避免切一次发一次请求。
  // 按整点对齐 now,免得每分钟 tick 都换一个 queryKey 触发重新拉取。
  const now = useNowSeconds()
  const timeRange = useMemo(() => {
    const alignedNow = now > 0 ? now - (now % 3600) + 3600 : 0
    return {
      start_timestamp: startOfDay(alignedNow) - (WINDOW_DAYS - 1) * 86400,
      end_timestamp: alignedNow,
    }
  }, [now])

  const { data, isPending } = useQuery({
    queryKey: ['plan-usage', 'quota-dates', 'subscription', timeRange],
    queryFn: () =>
      getUserQuotaDates({ ...timeRange, billing_source: 'subscription' }),
    select: (res) => (res.success ? res.data || [] : []),
    staleTime: 60_000,
    enabled: now > 0,
  })
  const isLoading = isPending || now === 0

  const items = useMemo(() => data ?? [], [data])

  /** 按自然日聚合:日起点 → 总量 + premium/basic 桶各自的调用与消耗 */
  const byDay = useMemo(() => {
    const map = new Map<
      number,
      {
        count: number
        tokens: number
        quota: number
        premiumCount: number
        basicCount: number
        premiumQuota: number
        basicTokens: number
      }
    >()
    for (let i = 0; i < WINDOW_DAYS; i++) {
      map.set(timeRange.start_timestamp + i * 86400, {
        count: 0,
        tokens: 0,
        quota: 0,
        premiumCount: 0,
        basicCount: 0,
        premiumQuota: 0,
        basicTokens: 0,
      })
    }
    for (const item of items) {
      const day = startOfDay(Number(item.created_at) || 0)
      const bucket = map.get(day)
      if (!bucket) continue
      const count = Number(item.count || 0)
      const tokens = Number(item.token_used || 0)
      const quota = Number(item.quota || 0)
      bucket.count += count
      bucket.tokens += tokens
      bucket.quota += quota
      // 后端已归一化:subscription 行的 bucket 只会是 premium/basic
      if (item.subscription_bucket === 'basic') {
        bucket.basicCount += count
        // basic 桶按 token 计量,消耗直接用 token 数
        bucket.basicTokens += tokens
      } else {
        bucket.premiumCount += count
        // premium 桶按额度(quota)计量
        bucket.premiumQuota += quota
      }
    }
    return map
  }, [items, timeRange.start_timestamp])

  const days = useMemo(
    () =>
      Array.from(byDay.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([ts, v]) => ({ ts, ...v })),
    [byDay]
  )

  const todayTs = startOfDay(now)
  const todayCount = byDay.get(todayTs)?.count ?? 0
  const sum7 = days.slice(-7).reduce((acc, d) => acc + d.count, 0)
  const sum30 = days.reduce((acc, d) => acc + d.count, 0)
  // 双桶消耗分开算:premium=quota 量纲,basic=token 量纲,不能合并
  const premiumQuota30 = days.reduce((acc, d) => acc + d.premiumQuota, 0)
  const basicTokens30 = days.reduce((acc, d) => acc + d.basicTokens, 0)
  const peakDay = days.reduce((max, d) => Math.max(max, d.count), 0)
  const activeDays = days.filter((d) => d.count > 0).length

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'numeric',
        day: 'numeric',
      }),
    [i18n.language]
  )

  const trendSpec = useMemo(() => {
    // 按桶拆两条线:同一天两条记录,seriesField 区分
    const premiumLabel = t('Premium models')
    const basicLabel = t('Basic models')
    const values = days.slice(-range).flatMap((d) => {
      const time = dateFmt.format(new Date(d.ts * 1000))
      return [
        { Time: time, Series: premiumLabel, rawValue: d.premiumCount },
        { Time: time, Series: basicLabel, rawValue: d.basicCount },
      ]
    })
    return {
      type: 'line',
      data: [{ id: 'planUsageTrend', values }],
      xField: 'Time',
      yField: 'rawValue',
      seriesField: 'Series',
      point: { visible: false },
      line: { style: { lineWidth: 2, curveType: 'monotone' } },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          label: { formatMethod: (v: number) => formatNumber(v) },
        },
      ],
      legends: { visible: true, orient: 'top', position: 'end' },
      title: { visible: false },
      background: { fill: 'transparent' },
      animation: true,
    }
  }, [days, range, dateFmt, t])

  const heatmapDays: HeatmapDay[] = useMemo(
    () => days.map((d) => ({ ts: d.ts, count: d.count, tokens: d.tokens })),
    [days]
  )

  return (
    <section className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-base font-semibold tracking-tight'>
          {t('API Usage')}
        </h3>
        {/* 口径提示:本区只统计套餐消耗,与用量信息页(按量付费)互补 */}
        <span className='text-muted-foreground text-xs'>
          {t('Subscription usage only; pay-as-you-go usage is on the Usage page')}
        </span>
      </div>

      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <StatTile
          value={formatNumber(todayCount)}
          label={t('Calls today')}
          loading={isLoading}
        />
        <StatTile
          value={formatNumber(sum7)}
          label={t('Calls in last 7 days')}
          loading={isLoading}
        />
        <StatTile
          value={formatNumber(sum30)}
          label={t('Calls in last 30 days')}
          loading={isLoading}
        />
      </div>

      <div className='grid grid-cols-1 gap-3 2xl:grid-cols-2'>
        <div className='bg-card rounded-2xl border p-5 sm:p-6'>
          {/* 区间切换只作用于这张折线图,所以放在卡内而不是区块标题旁 */}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h4 className='text-sm font-medium'>{t('Call trend')}</h4>
            <div className='flex items-center gap-1'>
              {([7, 30] as const).map((value) => (
                <Button
                  key={value}
                  variant={range === value ? 'secondary' : 'ghost'}
                  size='sm'
                  className={cn('h-7 px-2.5 text-xs')}
                  onClick={() => setRange(value)}
                >
                  {t('Last {{count}} days', { count: value })}
                </Button>
              ))}
            </div>
          </div>
          <div className='mt-3' style={{ height: '260px' }}>
            {isLoading ? (
              <Skeleton className='h-full w-full rounded-lg' />
            ) : (
              <VChart
                key={`plan-usage-trend-${range}-${days.length}`}
                spec={{ ...trendSpec, theme: 'light' }}
                option={VCHART_OPTION}
              />
            )}
          </div>
        </div>

        <div className='bg-card rounded-2xl border p-5 sm:p-6'>
          <h4 className='text-sm font-medium'>{t('Call heatmap')}</h4>
          <div className='mt-3 flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between'>
            {isLoading ? (
              <Skeleton className='h-[240px] w-full rounded-lg' />
            ) : (
              <>
                <UsageHeatmap days={heatmapDays} />
                {/* 三块等分卡片高度,跟左侧热力图齐头齐尾 */}
                <div className='grid shrink-0 grid-cols-3 gap-2 lg:w-40 lg:grid-cols-1'>
                  {[
                    {
                      // premium 桶按额度(quota)计量
                      value: formatQuota(premiumQuota30),
                      label: t('Premium credit spent'),
                    },
                    {
                      // basic 桶按 token 计量;累计 token 动辄上亿,紧凑记数好读
                      value: formatCompactNumber(basicTokens30),
                      label: t('Basic tokens spent'),
                    },
                    { value: formatNumber(peakDay), label: t('Daily peak') },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className='bg-muted/50 flex flex-col justify-center rounded-xl px-3.5 py-3'
                    >
                      <div className='text-2xl font-semibold tracking-tight tabular-nums'>
                        {stat.value}
                      </div>
                      <div className='text-muted-foreground mt-0.5 text-sm'>
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {!isLoading && (
            <div className='text-muted-foreground mt-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
              <span className='tabular-nums'>
                {t('{{count}} active days in the last 30 days', {
                  count: activeDays,
                })}
              </span>
              <HeatmapLegend />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
