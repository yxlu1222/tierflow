/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import type { PerfModelSummary } from '@/features/performance-metrics/types'
import { ConsoleCard } from '../overview/console-card'

/**
 * 平台级性能采样面板。perf_metrics 无用户维度,数据是全站口径,
 * 因此只挂在管理端专属的「用户分析」分区,概览页(用户端共用)不展示。
 */
const PERFORMANCE_WINDOW_HOURS = 24
const TOP_MODEL_LIMIT = 5

// Full-scale references for the decorative bar fills (purely visual — the mono
// value beside each bar carries the precise reading).
const LATENCY_FULL_MS = 1000
const THROUGHPUT_FULL_TPS = 120

type WeightedMetric = 'avg_latency_ms' | 'avg_tps' | 'success_rate'

function simpleAverage(
  rows: PerfModelSummary[],
  metric: WeightedMetric,
  isValid: (value: number) => boolean
): number {
  let total = 0
  let count = 0
  for (const row of rows) {
    const value = Number(row[metric])
    if (!isValid(value)) continue
    total += value
    count++
  }
  return count > 0 ? total / count : NaN
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

function rateTextClass(rate: number): string {
  if (!Number.isFinite(rate)) return 'text-muted-foreground'
  if (rate >= 99.9) return 'text-[var(--ov-good)]'
  if (rate >= 99) return 'text-[var(--ov-warn)]'
  return 'text-[var(--ov-bad)]'
}

function rateDotColor(rate: number): string {
  if (!Number.isFinite(rate)) return 'var(--muted-foreground)'
  if (rate >= 99.9) return 'var(--ov-good)'
  if (rate >= 99) return 'var(--ov-warn)'
  return 'var(--ov-bad)'
}

export function PerformanceHealthPanel() {
  const { t } = useTranslation()
  const metricsQuery = useQuery({
    queryKey: ['perf-metrics-summary', PERFORMANCE_WINDOW_HOURS],
    queryFn: () => getPerfMetricsSummary(PERFORMANCE_WINDOW_HOURS),
    staleTime: 60 * 1000,
    retry: false,
  })

  const models = useMemo(
    () => metricsQuery.data?.data.models ?? [],
    [metricsQuery.data]
  )

  const summary = useMemo(() => {
    return {
      avgLatencyMs: Math.round(
        simpleAverage(
          models,
          'avg_latency_ms',
          (v) => Number.isFinite(v) && v > 0
        )
      ),
      avgTps: simpleAverage(
        models,
        'avg_tps',
        (v) => Number.isFinite(v) && v > 0
      ),
      successRate: simpleAverage(models, 'success_rate', Number.isFinite),
    }
  }, [models])

  const topModels = useMemo(() => models.slice(0, TOP_MODEL_LIMIT), [models])
  const loading = metricsQuery.isLoading
  const hasData = models.length > 0

  const bars = [
    {
      key: 'success',
      label: t('Success rate'),
      value: formatUptimePct(summary.successRate),
      width: clampPct(summary.successRate),
      color: 'var(--ov-good)',
    },
    {
      key: 'latency',
      label: t('Average latency'),
      value: formatLatency(summary.avgLatencyMs),
      width: clampPct((summary.avgLatencyMs / LATENCY_FULL_MS) * 100),
      color: 'var(--ov-warn)',
    },
    {
      key: 'throughput',
      label: t('Throughput'),
      value: formatThroughput(summary.avgTps),
      width: clampPct((summary.avgTps / THROUGHPUT_FULL_TPS) * 100),
      color: 'var(--ov-accent)',
    },
  ]

  return (
    <ConsoleCard
      title={t('Platform performance health')}
      caption={t('Last 24 hours · platform-wide sample')}
    >
      <div className='flex flex-col gap-3'>
        {bars.map((bar) => (
          <div key={bar.key}>
            <div className='flex items-baseline justify-between'>
              <span className='text-muted-foreground text-[11px] font-semibold tracking-[0.09em] uppercase'>
                {bar.label}
              </span>
              {loading ? (
                <Skeleton className='h-4 w-14' />
              ) : (
                <span
                  className={cn(
                    'font-mono text-[17px] leading-none font-semibold tabular-nums',
                    bar.key === 'success'
                      ? rateTextClass(summary.successRate)
                      : 'text-foreground'
                  )}
                >
                  {bar.value}
                </span>
              )}
            </div>
            <div className='bg-muted/60 mt-[7px] h-1.5 overflow-hidden rounded-[4px]'>
              <span
                className='block h-full rounded-[4px] transition-[width] duration-500'
                style={{
                  width: loading ? '0%' : `${bar.width}%`,
                  background: bar.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {hasData && (
        <>
          <div className='bg-border/60 my-[15px] h-px' />
          <span className='text-muted-foreground mb-[11px] block text-[11px] font-semibold tracking-[0.09em] uppercase'>
            {t('Top models by traffic')}
          </span>
          <div className='flex flex-col gap-[9px]'>
            {topModels.map((model) => (
              <div
                key={model.model_name}
                className='flex items-center gap-[9px] text-[12.5px]'
              >
                <span
                  className='size-[7px] shrink-0 rounded-full'
                  style={{ background: rateDotColor(model.success_rate) }}
                  aria-hidden='true'
                />
                <span className='text-foreground/80 min-w-0 flex-1 truncate font-mono'>
                  {model.model_name}
                </span>
                <span className='text-muted-foreground font-mono text-[11.5px] tabular-nums'>
                  {formatUptimePct(model.success_rate)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </ConsoleCard>
  )
}
