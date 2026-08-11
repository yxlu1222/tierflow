/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 「模型调用分布」环图 —— 用量页右侧,与左边合并后的 KPI 卡并排。
 *
 * 口径与数据分析页的「调用模型占比」共用 `aggregateByHitModelGroup`:分片是用户
 * 实际调用到的模型(内部取模型组名,组名即规范模型名),未经模型组路由的流量整行
 * 丢弃。措辞刻意不提"模型组""路由""命中"——详见该函数注释。
 *
 * 分片依据是调用次数;花费不参与几何(一个扇形只能编码一个量),随模型名一起
 * 出现在悬停浮层里。所有模型都具名展示,不做 Top-N 折叠、不产生「其他」。
 *
 * 时间窗**由本卡自己持有**(今天 / 近 7 天 / 近 30 天),不跟随左边 KPI 卡的固定
 * 7 天 —— 所以取数也在本组件内,不再从 useOverviewData 借 rows。但用的是同一个
 * `userQuotaRowsQuery` 定义,所以默认那档(近 7 天)与 KPI 卡命中同一个缓存键、
 * 全页只发一次请求;三个窗口各自缓存,来回切 tab 也不重复打。
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { FIXED_THEME_PRESET, FIXED_THEME_RADIUS } from '@/lib/fixed-theme'
import { formatNumber, formatQuota } from '@/lib/format'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import { VCHART_OPTION } from '@/lib/vchart'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { userQuotaRowsQuery } from '@/features/dashboard/hooks/use-overview-data'
import { getThemeChartColors } from '@/features/dashboard/lib/charts'
import {
  aggregateByHitModelGroup,
  buildHitModelGroupColor,
} from '@/features/dashboard/lib/hit-model-group'
import { ConsoleCard } from './console-card'

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

/** 本卡可选的时间窗。`days: 0` = 今天(当天零点起)。 */
const RANGES = [
  { key: 'today', days: 0 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
] as const

type RangeKey = (typeof RANGES)[number]['key']

/**
 * `/api/data/self` 硬性拒绝跨度 > 1 个月的查询(controller/usedata.go:100),
 * 而滚动 30 天窗口的跨度**正好等于** 2592000 秒 —— 卡在边界上,余量为 0。留 60 秒
 * 余量,免得哪天 endOf 的粒度一改就变成用户面前的一个红色报错。
 */
const MAX_SPAN_SEC = 30 * 24 * 3600 - 60

/** 把窗口 key 解成 Unix 秒区间。今天从当天 00:00 起,其余按整小时滚动回溯。 */
function resolveRange(key: RangeKey): {
  start_timestamp: number
  end_timestamp: number
} {
  const end = dayjs().endOf('hour')
  const days = RANGES.find((r) => r.key === key)?.days ?? 7
  const rawStart =
    days === 0
      ? dayjs().startOf('day').unix()
      : end.subtract(days, 'day').unix()
  return {
    start_timestamp: Math.max(rawStart, end.unix() - MAX_SPAN_SEC),
    end_timestamp: end.unix(),
  }
}

export function ModelShareChart() {
  const { t } = useTranslation()
  const [range, setRange] = useState<RangeKey>('7d')
  // 与其它图表一致地跟随主题刷新(亮/暗切换后重算颜色与圆角)
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${FIXED_THEME_PRESET}:${FIXED_THEME_RADIUS}`
  )

  const timeRange = useMemo(() => resolveRange(range), [range])

  // 与 KPI 卡共用同一个 query 定义 —— 默认的近 7 天窗口与 KPI 完全一致,因此命中
  // 同一个缓存键、只发一次请求(口径也随之统一为按量付费)。
  const query = useQuery(userQuotaRowsQuery(timeRange))

  const rows = useMemo(() => query.data?.data ?? [], [query.data])
  const loading = query.isLoading
  // 取数失败必须与"这段时间真的没调用"分开:/api/data/self 在跨度超限
  // (controller/usedata.go:100)和任何 DB 错误时都返回 HTTP 200 + success:false,
  // 只看 data 会把两者都渲染成「暂无数据」,用户会以为自己没有用量。
  const failed = query.isError || query.data?.success === false

  const rangeTabs = (
    <Tabs value={range} onValueChange={(v) => setRange(v as RangeKey)}>
      <TabsList>
        {RANGES.map((r) => (
          <TabsTrigger key={r.key} value={r.key} className='px-2.5 text-xs'>
            {r.days === 0
              ? t('Today')
              : t('Last {{count}} days', { count: r.days })}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )

  const { spec, isEmpty } = useMemo(() => {
    const slices = aggregateByHitModelGroup(loading ? [] : rows)
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
            id: 'modelShare',
            values: slices.map((s) => ({
              model: s.name,
              count: s.count,
              quota: s.quota,
            })),
          },
        ],
        valueField: 'count',
        categoryField: 'model',
        outerRadius: 0.82,
        innerRadius: 0.55,
        // 片间留缝:相邻填充之间需要 surface 间隙,否则边界只靠色相区分
        padAngle: 0.8,
        pie: {
          style:
            chartRadius == null
              ? {}
              : { cornerRadius: Math.min(chartRadius, 6) },
          state: { hover: { outerRadius: 0.86 } },
        },
        // 关掉切片标签:窄栏里外置引线标签会互相碰撞(管理端同款图表也显式关闭)。
        // 图例**只给模型名**,不带占比 —— 占比与次数只在悬停浮层出现(产品要求)。
        // ⚠️ 代价:亮色面上 series-3/4/5(aqua 2.82:1 / yellow 2.17:1 / magenta
        // 2.69:1)低于 3:1,而本页环图没有同页明细表,于是不再有任何**常显**的数值
        // 通道 —— 色块辨认不出来的读者只能靠逐个悬停。数据分析页那张同款环图不受
        // 影响(正下方就是模型调用明细表,relief 由它承担)。
        label: { visible: false },
        legends: { visible: true, orient: 'bottom' },
        color,
        // 浮层三行(占比 / 次数 / 消耗),与数据分析页的同款环图逐字一致。标题已经是
        // 模型名,所以内容行的键不再重复模型名(那是之前的 bug:标题和第一行都在写
        // 同一个名字)。次数单独一行,值不再带"次"—— 键已经写了「调用次数」。
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
  }, [rows, loading, chartRadius, t])

  return (
    <ConsoleCard
      title={t('Model call distribution')}
      caption={t('Share by call count')}
      actions={rangeTabs}
      loading={loading}
      empty={failed || isEmpty}
      emptyMessage={failed ? t('Failed to load data') : t('No data available')}
      contentHeight='260px'
    >
      <div className='h-[260px]'>
        {spec && (
          <VChart
            // 分片集合变化时重建实例,避免 VChart 复用旧的 ordinal 色标。切时间窗
            // 也要重建:两个窗口的行数可能相同但模型集合不同,只看 length 会漏。
            key={`model-share-${range}-${rows.length}`}
            spec={spec}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </ConsoleCard>
  )
}
