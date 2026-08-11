/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 调用热力图 —— 近 30 天按天的请求量密度网格(行=星期,列=自然周)。
 *
 * 不用图表库:格子是纯 CSS grid,比 VChart 的 heatmap 轻得多,也更容易跟
 * 页面的 bg-card/border 语义 token 对齐。色阶用 primary 的透明度分档,
 * 保证在任何主题色下都成立。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface HeatmapDay {
  /** 当天 00:00 的 unix 秒 */
  ts: number
  count: number
  tokens: number
}

interface UsageHeatmapProps {
  days: HeatmapDay[]
}

/** 0 → 无色;其余按峰值四分位上色 */
function levelOf(count: number, peak: number): number {
  if (count <= 0 || peak <= 0) return 0
  const ratio = count / peak
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.75) return 3
  return 4
}

const LEVEL_CLASS = [
  'bg-muted',
  'bg-primary/20',
  'bg-primary/40',
  'bg-primary/65',
  'bg-primary',
] as const

export function UsageHeatmap({ days }: UsageHeatmapProps) {
  const { t, i18n } = useTranslation()

  const peak = useMemo(
    () => days.reduce((max, d) => Math.max(max, d.count), 0),
    [days]
  )

  // 列 = 自然周(周一起始),行 = 周一..周日。首周不足处补空位,
  // 否则第一列会从周一开始画,与真实星期错位。
  const weeks = useMemo(() => {
    if (days.length === 0) return [] as (HeatmapDay | null)[][]
    const cols: (HeatmapDay | null)[][] = []
    let current: (HeatmapDay | null)[] = []
    const firstWeekday = (new Date(days[0].ts * 1000).getDay() + 6) % 7
    for (let i = 0; i < firstWeekday; i++) current.push(null)
    for (const day of days) {
      current.push(day)
      if (current.length === 7) {
        cols.push(current)
        current = []
      }
    }
    if (current.length > 0) {
      while (current.length < 7) current.push(null)
      cols.push(current)
    }
    return cols
  }, [days])

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' })
    // 本地时间的 2024-01-01 是周一,顺推 7 天拿到本地化的周一..周日。
    // 必须用本地构造(不能用 Date.UTC),否则非 UTC 时区会整体错位一天,
    // 而格子的行号是按 getDay() 的本地星期排的。
    return Array.from({ length: 7 }, (_, i) =>
      fmt.format(new Date(2024, 0, 1 + i))
    )
  }, [i18n.language])

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        month: 'long',
        day: 'numeric',
      }),
    [i18n.language]
  )

  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'short' }),
    [i18n.language]
  )

  // 每列顶部的月份标签:只在该列跨入新月份时出现,其余列留空
  const monthLabels = useMemo(() => {
    let prevMonth = -1
    return weeks.map((week) => {
      const first = week.find(Boolean)
      if (!first) return ''
      const date = new Date(first.ts * 1000)
      const month = date.getMonth()
      if (month === prevMonth) return ''
      prevMonth = month
      return monthFmt.format(date)
    })
  }, [weeks, monthFmt])

  return (
    <div className='flex flex-col'>
      <div className='flex gap-2 overflow-x-auto'>
        <div className='text-muted-foreground flex shrink-0 flex-col gap-1.5 pr-1 text-xs'>
          {/* 占位:对齐右侧的月份标签行 */}
          <span className='h-4' aria-hidden='true' />
          {weekdayLabels.map((label, i) => (
            <span
              key={label}
              className='flex h-7 items-center leading-none'
              // 与 GitHub 一致:只标奇数行,避免小字挤在一起
              aria-hidden={i % 2 === 1}
            >
              {i % 2 === 0 ? label : ''}
            </span>
          ))}
        </div>
        <div className='flex gap-1.5'>
          {weeks.map((week, wi) => (
            <div key={wi} className='flex flex-col gap-1.5'>
              <span className='text-muted-foreground h-4 text-xs leading-4 whitespace-nowrap'>
                {monthLabels[wi]}
              </span>
              {week.map((day, di) =>
                day ? (
                  <Tooltip key={day.ts}>
                    <TooltipTrigger
                      render={
                        <div
                          className={cn(
                            'size-7 rounded-[5px]',
                            LEVEL_CLASS[levelOf(day.count, peak)]
                          )}
                        />
                      }
                    />
                    <TooltipContent>
                      <div className='tabular-nums'>
                        {dateFmt.format(new Date(day.ts * 1000))}
                      </div>
                      <div className='tabular-nums'>
                        {t('{{amount}} tokens', {
                          amount: day.tokens.toLocaleString(),
                        })}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div key={`empty-${wi}-${di}`} className='size-7' />
                )
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 色阶图例 —— 与热力图分开导出,好让调用方把它摆到卡片底栏 */
export function HeatmapLegend() {
  const { t } = useTranslation()
  return (
    <div className='text-muted-foreground flex items-center gap-1 text-xs'>
      <span>{t('Less')}</span>
      {LEVEL_CLASS.map((klass) => (
        <span key={klass} className={cn('size-3 rounded-[3px]', klass)} />
      ))}
      <span>{t('More')}</span>
    </div>
  )
}
