/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  formatLocalCurrencyAmount,
  formatQuotaWithCurrency,
  getCurrencyDisplay,
} from '@/lib/currency'
import { formatChartTime, type TimeGranularity } from '@/lib/time'
import { getFinanceData } from '@/features/dashboard/api'
import { buildContiguousTimePoints } from '@/features/dashboard/lib'
import type { FinancePoint, FinanceSummary } from '@/features/dashboard/types'
import { ConsoleChartCard } from '../console-chart-card'
import { ConsoleKpiStrip, type ConsoleKpiCell } from '../console-kpi-strip'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VChartSpec = Record<string, any>

interface TrendDatum {
  Time: string
  Series: string
  rawValue: number
}

interface SeriesDef {
  key: keyof FinancePoint
  label: string
}

interface FinanceChartsProps {
  startTimestamp: number
  endTimestamp: number
  granularity: TimeGranularity
}

// Semantic series colours drawn from the `.dash-console` teal/red palette
// (literal hex — VChart specs can't read CSS vars).
const SERIES_COLORS = {
  revenue: '#1f9d55',
  cost: '#d64545',
  margin: '#0f8a7e',
  recharge: '#0f8a7e',
} as const

// 把小时桶数据点按所选粒度二次归并，按 (时间, 序列) 求和，得到趋势图 values。
function aggregateTrend(
  points: FinancePoint[],
  granularity: TimeGranularity,
  seriesDefs: SeriesDef[]
): TrendDatum[] {
  const byTime = new Map<string, Map<string, number>>()
  const timeKeys = new Set<string>()
  for (const p of points) {
    const tk = formatChartTime(Number(p.created_at), granularity)
    timeKeys.add(tk)
    let inner = byTime.get(tk)
    if (!inner) {
      inner = new Map()
      byTime.set(tk, inner)
    }
    for (const s of seriesDefs) {
      inner.set(s.label, (inner.get(s.label) || 0) + (Number(p[s.key]) || 0))
    }
  }
  // 后端只回传有流量的桶，空闲时段整段缺失，直接上 band 轴会画成时间轴上
  // 不存在过这段（…07-10, 07-12, 07-13, 07-15…）。补齐成连续时间轴，空洞归零。
  const sortedKeys = buildContiguousTimePoints(
    Array.from(timeKeys),
    points.map((p) => Number(p.created_at) || 0),
    granularity
  )
  const values: TrendDatum[] = []
  for (const tk of sortedKeys) {
    for (const s of seriesDefs) {
      values.push({
        Time: tk,
        Series: s.label,
        rawValue: byTime.get(tk)?.get(s.label) || 0,
      })
    }
  }
  return values
}

/** Quota → the currency magnitude `formatQuotaWithCurrency` will print. */
function quotaToDisplayUnits(quota: number): number {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return quota
  const rate = 'exchangeRate' in meta ? meta.exchangeRate : 1
  return (quota / config.quotaPerUnit) * rate
}

/**
 * Build an axis-tick formatter whose precision follows the series peak.
 *
 * The shared currency formatters round sub-¥1 figures to a fixed width, so every
 * tick of a low-volume range collapses onto the same label (¥0.01 / ¥0.01 /
 * ¥0.00) — an axis that says nothing. Widen the fraction only when the peak is
 * small enough to need it.
 *
 * `toDisplay` maps a raw series value into the units the axis prints, since
 * revenue/cost/margin arrive as quota while recharge is already currency.
 */
function makeAxisFormatter(
  values: TrendDatum[],
  format: (v: number, digits: number) => string,
  toDisplay: (raw: number) => number
): (v: number) => string {
  const peak = values.reduce(
    (max, d) => Math.max(max, Math.abs(Number(d.rawValue) || 0)),
    0
  )
  const magnitude = Math.abs(toDisplay(peak))
  const digits =
    !Number.isFinite(magnitude) || magnitude === 0
      ? 2
      : magnitude >= 1
        ? 2
        : magnitude >= 0.01
          ? 4
          : 6
  return (v: number) => format(v, digits)
}

// Finance trends are always line charts (the chart-type preference was removed).
function buildTrendSpec(opts: {
  values: TrendDatum[]
  format: (v: number) => string
  /** Axis-tick formatter; falls back to `format` when precision needs no help. */
  axisFormat?: (v: number) => string
  color?: VChartSpec
}): VChartSpec {
  const valueFmt = (d: Record<string, unknown>) =>
    opts.format(Number(d?.rawValue) || 0)
  const axisFmt = opts.axisFormat ?? opts.format
  return {
    type: 'line',
    data: [{ id: 'financeTrend', values: opts.values }],
    xField: 'Time',
    yField: 'rawValue',
    seriesField: 'Series',
    stack: false,
    point: { visible: false },
    line: { style: { lineWidth: 2, curveType: 'monotone' } },
    ...(opts.color ? { color: opts.color } : {}),
    axes: [
      { orient: 'bottom', type: 'band' },
      {
        orient: 'left',
        type: 'linear',
        label: { formatMethod: (value: number) => axisFmt(value) },
      },
    ],
    tooltip: {
      mark: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.Series,
            value: valueFmt,
          },
        ],
      },
      dimension: {
        content: [
          {
            key: (datum: Record<string, unknown>) => datum?.Series,
            value: valueFmt,
          },
        ],
      },
    },
    background: { fill: 'transparent' },
    animation: true,
  }
}

export function FinanceCharts(props: FinanceChartsProps) {
  const { startTimestamp, endTimestamp, granularity } = props
  const { t } = useTranslation()
  const palette = SERIES_COLORS

  const timeRange = useMemo(
    () => ({ start_timestamp: startTimestamp, end_timestamp: endTimestamp }),
    [startTimestamp, endTimestamp]
  )

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'finance', timeRange],
    queryFn: () => getFinanceData(timeRange),
    select: (res): FinanceSummary | null => (res.success ? res.data : null),
    staleTime: 60_000,
  })

  const points = useMemo(() => data?.points ?? [], [data])
  const isEmpty = !isLoading && points.length === 0

  const marginSpec = useMemo(() => {
    const revenueLabel = t('Revenue')
    const costLabel = t('Upstream Cost')
    const marginLabel = t('Margin')
    const values = aggregateTrend(points, granularity, [
      { key: 'revenue', label: revenueLabel },
      { key: 'provider_cost', label: costLabel },
      { key: 'margin', label: marginLabel },
    ])
    return buildTrendSpec({
      values,
      format: (v) => formatQuotaWithCurrency(v),
      axisFormat: makeAxisFormatter(
        values,
        (v, digits) => formatQuotaWithCurrency(v, { digitsSmall: digits }),
        quotaToDisplayUnits
      ),
      color: {
        type: 'ordinal',
        domain: [revenueLabel, costLabel, marginLabel],
        range: [palette.revenue, palette.cost, palette.margin],
      },
    })
  }, [points, granularity, palette, t])

  const rechargeSpec = useMemo(() => {
    const walletLabel = t('Wallet Top-ups')
    const planLabel = t('Plan Purchases (cash)')
    const fromBalanceLabel = t('Balance-paid Plans')
    // 三来源分开画:钱包充值 / 套餐现金购买 / 套餐余额购买。
    // 旧后端不下发拆分字段:钱包序列回退到总额(其余两序列 aggregateTrend 自会归零),
    // 图形与旧版一致。
    const normPoints = points.map((p) => ({
      ...p,
      recharge_wallet: p.recharge_wallet ?? p.recharge,
    }))
    const values = aggregateTrend(normPoints, granularity, [
      { key: 'recharge_wallet', label: walletLabel },
      { key: 'recharge_subscription', label: planLabel },
      { key: 'recharge_from_balance', label: fromBalanceLabel },
    ])
    return buildTrendSpec({
      values,
      format: (v) => formatLocalCurrencyAmount(v),
      axisFormat: makeAxisFormatter(
        values,
        (v, digits) => formatLocalCurrencyAmount(v, { digitsSmall: digits }),
        (raw) => raw
      ),
      color: {
        type: 'ordinal',
        domain: [walletLabel, planLabel, fromBalanceLabel],
        range: [palette.recharge, palette.revenue, palette.cost],
      },
    })
  }, [points, granularity, palette, t])

  // Per-bucket series for the KPI sparklines (ordered by time ascending).
  const series = useMemo(() => {
    const sorted = [...points].sort(
      (a, b) => Number(a.created_at) - Number(b.created_at)
    )
    return {
      recharge: sorted.map((p) => Number(p.recharge) || 0),
      revenue: sorted.map((p) => Number(p.revenue) || 0),
      cost: sorted.map((p) => Number(p.provider_cost) || 0),
      margin: sorted.map((p) => Number(p.margin) || 0),
    }
  }, [points])

  const revenue = data?.total_revenue ?? 0
  const margin = data?.total_margin ?? 0
  const marginRate = revenue > 0 ? (margin / revenue) * 100 : null

  // 现金毛利率 = (现金充值 − 上游成本) / 现金充值。订阅的"额度营收"是名义售价
  // (用户实付固定月费),额度毛利率会被它污染;现金口径才反映真实资金效率。
  // 成本是 quota,经 quotaToDisplayUnits 折算到展示货币再与充值相减 —— 这依赖
  // 全 app 的既有假设:TopUp.money 以展示货币计(formatLocalCurrencyAmount 直接
  // 给它套展示符号)。若站点收款货币与展示货币不一致(如 CNY 收款 + USD 展示),
  // 现有充值 KPI 与本比率会一同失真;根治需要后端暴露支付货币配置,不在本层修。
  // TOKENS 展示模式下 quota 无货币语义,不算(显示 —)。旧后端无拆分字段时同样不算。
  const cashRecharge = data?.total_recharge_cash
  const { meta: currencyMeta } = getCurrencyDisplay()
  const cashMarginRate =
    cashRecharge != null && cashRecharge > 0 && currencyMeta.kind !== 'tokens'
      ? ((cashRecharge - quotaToDisplayUnits(data?.total_provider_cost ?? 0)) /
          cashRecharge) *
        100
      : null

  const kpiCells: ConsoleKpiCell[] = [
    {
      key: 'recharge',
      label: t('Recharge (range)'),
      value: formatLocalCurrencyAmount(data?.total_recharge ?? 0),
      // 三来源分开计:钱包充值 / 套餐现金购买 / 套餐余额购买(后者是钱包内部
      // 转移,那笔钱充值时已计过一次)。全部来自钱包充值时拆分行没有信息量,
      // 保留原有的笔数副标题(Go 对零值照样序列化,判 != null 会让原文案永久消失)。
      sub:
        (data?.total_recharge_subscription ?? 0) > 0 ||
        (data?.total_recharge_from_balance ?? 0) > 0
          ? t(
              'Wallet {{wallet}} · plans {{plans}} · balance-paid {{balance}}',
              {
                wallet: formatLocalCurrencyAmount(
                  data?.total_recharge_wallet ?? 0
                ),
                plans: formatLocalCurrencyAmount(
                  data?.total_recharge_subscription ?? 0
                ),
                balance: formatLocalCurrencyAmount(
                  data?.total_recharge_from_balance ?? 0
                ),
              }
            )
          : t('{{count}} paid top-ups', {
              count: data?.total_recharge_count ?? 0,
            }),
      spark: series.recharge,
      sparkColor: 'var(--ov-accent)',
    },
    {
      key: 'revenue',
      label: t('Revenue (range)'),
      value: formatQuotaWithCurrency(revenue),
      // 套餐额度消耗是名义售价、不产生新现金流入 —— 与充值 KPI 不可相加。
      // 全站无订阅消费时拆分行没有信息量,保留原有的请求数副标题
      // (Go 对零值照样序列化,判 != null 会让请求数永久消失)。
      sub:
        (data?.total_revenue_subscription ?? 0) > 0
          ? t('Wallet {{wallet}} · plan quota {{subscription}}', {
              wallet: formatQuotaWithCurrency(data?.total_revenue_wallet ?? 0),
              subscription: formatQuotaWithCurrency(
                data?.total_revenue_subscription ?? 0
              ),
            })
          : t('{{count}} requests', { count: data?.total_requests ?? 0 }),
      spark: series.revenue,
      sparkColor: 'var(--ov-good)',
    },
    {
      key: 'cost',
      label: t('Upstream Cost (range)'),
      value: formatQuotaWithCurrency(data?.total_provider_cost ?? 0),
      sub: t('Upstream providers'),
      spark: series.cost,
      sparkColor: 'var(--ov-bad)',
    },
    {
      key: 'margin',
      label: t('Margin Rate (range)'),
      value: marginRate == null ? '—' : marginRate.toFixed(1),
      unit: marginRate == null ? undefined : '%',
      valueClass:
        margin >= 0 ? 'text-[var(--ov-good)]' : 'text-[var(--ov-bad)]',
      sub:
        cashMarginRate == null
          ? t('Margin: {{amount}}', {
              amount: formatQuotaWithCurrency(margin),
            })
          : t('Margin: {{amount}} · cash margin {{rate}}%', {
              amount: formatQuotaWithCurrency(margin),
              rate: cashMarginRate.toFixed(1),
            }),
      spark: series.margin,
      sparkColor: 'var(--ov-accent)',
    },
    {
      key: 'balance',
      label: t('Current Total Balance'),
      value: formatQuotaWithCurrency(data?.current_balance ?? 0),
      sub: t('Across all users'),
      spark: [],
      sparkColor: 'var(--ov-accent)',
    },
  ]

  return (
    <div className='flex flex-col gap-4'>
      <ConsoleKpiStrip cells={kpiCells} loading={isLoading} columns={5} />

      <div className='grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2'>
        <ConsoleChartCard
          title={
            <span className='inline-flex flex-wrap items-baseline gap-x-2'>
              {t('Revenue / Cost / Margin')}
              <span className='text-muted-foreground text-xs font-normal'>
                {t('Plan-quota split available since column migration')}
              </span>
            </span>
          }
          spec={marginSpec}
          chartKey={`finance-margin-${granularity}-${points.length}`}
          loading={isLoading}
          isEmpty={isEmpty}
          emptyMessage={t('No data available')}
        />
        <ConsoleChartCard
          title={
            <span className='inline-flex flex-wrap items-baseline gap-x-2'>
              {t('Recharge Trend')}
              <span className='text-muted-foreground text-xs font-normal'>
                {t('Not additive with revenue')}
              </span>
            </span>
          }
          spec={rechargeSpec}
          chartKey={`finance-recharge-${granularity}-${points.length}`}
          loading={isLoading}
          isEmpty={isEmpty}
          emptyMessage={t('No data available')}
        />
      </div>
    </div>
  )
}
