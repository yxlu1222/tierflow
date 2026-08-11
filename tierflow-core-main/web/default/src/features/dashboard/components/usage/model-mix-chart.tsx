/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import { FIXED_THEME_PRESET, FIXED_THEME_RADIUS } from '@/lib/fixed-theme'
import { formatNumber, formatQuota } from '@/lib/format'
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
 * 与用量信息页的「模型调用分布」共用 `aggregateByHitModelGroup`:分片是实际调用到的
 * 模型(内部取模型组名 = 规范模型名),未经模型组路由的流量整行丢弃 —— 不再走
 * `model_group || strategy` 的通用回落链,那会把请求方案名混排进同一个图例(详见该
 * 函数注释)。所有模型具名展示,不做 Top-N 折叠、不产生「其他」。
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
              quota: s.quota,
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
        // 浮层三行(占比 / 次数 / 消耗),与用量信息页的同款环图逐字一致;标题已是
        // 模型名,内容行不再重复它。
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
              {
                key: () => t('Spend'),
                value: (datum: Record<string, unknown>) =>
                  formatQuota(Number(datum?.quota) || 0),
              },
            ],
          },
        },
        background: { fill: 'transparent' },
        animation: true,
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
      <div className='h-[300px]'>
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
