/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import { FIXED_THEME_PRESET, FIXED_THEME_RADIUS } from '@/lib/fixed-theme'
import { formatNumber } from '@/lib/format'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import { VCHART_OPTION } from '@/lib/vchart'
import { getThemeChartColors } from '@/features/dashboard/lib/charts'
import {
  aggregateByHitModelGroup,
  buildHitModelGroupColor,
} from '@/features/dashboard/lib/hit-model-group'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { ConsoleCard } from '../overview/console-card'

// --series-1..8 读不到时的兜底(SSR / 令牌缺失),与 styles/theme.css 的亮色取值一致
const FALLBACK_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
]

interface ModelMixChartProps {
  data: QuotaDataItem[]
  loading?: boolean
  isEmpty?: boolean
}

/**
 * 「调用模型占比」环图(数据分析页)。
 *
 * 与用量信息页的「模型调用分布」共用 `aggregateByHitModelGroup`:优先按实际命中的
 * 模型组聚合；一体机采用固定本地路由、模型组为空时，回退到请求中的具体模型名。
 * 所有模型具名展示,不做 Top-N 折叠、不产生「其他」。
 */
export function ModelMixChart(props: ModelMixChartProps) {
  const { t } = useTranslation()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${FIXED_THEME_PRESET}:${FIXED_THEME_RADIUS}`
  )

  const { spec, isEmpty } = useMemo(() => {
    const slices = aggregateByHitModelGroup(props.loading ? [] : props.data)
    if (slices.length === 0) return { spec: null, isEmpty: true }

    const totalCount = slices.reduce((sum, s) => sum + s.count, 0)
    const color = buildHitModelGroupColor(
      slices,
      getThemeChartColors(FIXED_THEME_PRESET),
      FALLBACK_COLORS
    )

    return {
      isEmpty: false,
      spec: {
        type: 'pie',
        data: [
          {
            id: 'modelMix',
            values: slices.map((s) => ({
              model: s.name,
              count: s.count,
            })),
          },
        ],
        valueField: 'count',
        categoryField: 'model',
        outerRadius: 0.9,
        innerRadius: 0.5,
        padAngle: 0.6,
        pie: {
          style:
            chartRadius == null
              ? {}
              : { cornerRadius: Math.min(chartRadius, 6) },
          state: { hover: { outerRadius: 0.94 } },
        },
        // ConsoleCard 头部已经写了卡名;引线标签在这个宽度下会互相碰撞。
        // 图例只给模型名,占比与次数只在悬停浮层出现(与用量信息页一致)。亮色面上
        // series-3/4/5 低于 3:1,本页的 relief 由正下方的模型调用明细表承担。
        title: { visible: false },
        label: { visible: false },
        legends: { visible: true, orient: 'bottom' },
        color,
        // 标题显示模型名，浮层只保留用量口径的占比和次数。
        tooltip: {
          mark: {
            title: {
              value: (datum: Record<string, unknown>) =>
                String(datum?.model ?? ''),
            },
            content: [
              {
                key: () => t('Call proportion'),
                value: (datum: Record<string, unknown>) => {
                  const count = Number(datum?.count) || 0
                  const pct = totalCount > 0 ? (count / totalCount) * 100 : 0
                  return `${pct.toFixed(1)}%`
                },
              },
              {
                key: () => t('Call count'),
                value: (datum: Record<string, unknown>) =>
                  formatNumber(Number(datum?.count) || 0),
              },
            ],
          },
        },
        background: { fill: 'transparent' },
        animation: false,
      },
    }
  }, [props.data, props.loading, chartRadius, t])

  return (
    <ConsoleCard
      title={t('Model call share')}
      caption={t('Share by call count')}
      loading={props.loading}
      empty={props.isEmpty || isEmpty}
      emptyMessage={t('No data available')}
      contentHeight='300px'
    >
      <div className='h-[300px] min-w-0 overflow-hidden'>
        {spec && (
          <VChart
            key={`model-mix-${props.data.length}`}
            spec={spec}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </ConsoleCard>
  )
}
