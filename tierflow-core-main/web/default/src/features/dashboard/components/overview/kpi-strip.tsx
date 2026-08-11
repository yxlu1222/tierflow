/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 近 7 天的三个标量:消费 / Tokens / 请求数,收在**同一张卡**里纵向排列。
 *
 * 为什么并成一张:右侧要并排放「模型调用分布」环图,三张横排小卡与一张图并列会
 * 让这一行出现四个视觉块、比重失衡;纵向排列后左右各一块,且三个数共享同一个
 * 观察窗口(近 7 天)—— 它们本就是同一份数据的三个切面,同卡更贴合语义。
 *
 * 刻意保持「只有数字」:
 * - 没有卡内迷你趋势图 —— 首屏定位是轻量展示台,趋势要看就去日志表按条看。
 * - 余额和套餐额度由 AccountStrip 承担,那里才说得清「按量付费 / 订阅制互不
 *   串扣」的区别,挤进 KPI 格只会丢掉这层语义。
 */
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { OverviewData } from '../../hooks/use-overview-data'

function SpendDelta({ pct }: { pct: number }) {
  const up = pct >= 0
  return (
    <span
      className={cn(
        'font-mono font-semibold tabular-nums',
        up ? 'text-[var(--ov-good)]' : 'text-[var(--ov-bad)]'
      )}
    >
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

interface KpiCellData {
  key: string
  label: string
  value: string
  sub: React.ReactNode
  loading: boolean
}

interface KpiStripProps {
  overview: OverviewData
  rangeLabel: string
}

export function KpiStrip(props: KpiStripProps) {
  const { t } = useTranslation()
  const { overview, rangeLabel } = props

  const cells: KpiCellData[] = [
    {
      key: 'spend',
      label: t('Usage this period'),
      value: formatQuota(overview.totals.totalQuota),
      sub:
        overview.spendDeltaPct == null ? (
          rangeLabel
        ) : (
          <>
            <SpendDelta pct={overview.spendDeltaPct} />{' '}
            {t('vs previous period')}
          </>
        ),
      loading: overview.loading,
    },
    {
      key: 'tokens',
      label: t('Token usage'),
      value: formatNumber(overview.totals.totalTokens),
      sub: rangeLabel,
      loading: overview.loading,
    },
    {
      key: 'requests',
      label: t('Request count'),
      value: formatNumber(overview.totals.totalCount),
      sub: rangeLabel,
      loading: overview.loading,
    },
  ]

  return (
    // 单卡纵向:三项之间用分隔线而不是留白,读作「同一份数据的三个切面」。
    // 卡片撑满父容器高度,与右侧环图卡对齐。
    <div className='bg-card flex h-full flex-col rounded-2xl border p-5 sm:p-6'>
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          className={cn(
            'flex-1',
            index > 0 && 'mt-4 border-t pt-4 sm:mt-5 sm:pt-5'
          )}
        >
          <div className='text-muted-foreground text-[11px] font-semibold tracking-[0.09em] uppercase'>
            {cell.label}
          </div>
          {cell.loading ? (
            <>
              <Skeleton className='mt-[9px] h-[26px] w-24' />
              <Skeleton className='mt-[6px] h-3.5 w-28' />
            </>
          ) : (
            <>
              <div className='text-foreground mt-[9px] font-mono text-[26px] leading-none font-semibold tracking-tight tabular-nums'>
                {cell.value}
              </div>
              <div className='text-muted-foreground mt-[6px] truncate text-xs'>
                {cell.sub}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
