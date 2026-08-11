/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getCostByChannel, getCostByModel } from '@/features/dashboard/api'
import type { CostDimensionRow } from '@/features/dashboard/types'
import { ConsoleCard } from '../overview/console-card'

// Revenue / cost / margin are raw quota (token units) → display currency.
const money = (v: number) => formatQuotaWithCurrency(v)
// Requests is a plain count, not quota — never currency-format it.
const count = (v: number) => v.toLocaleString()
const toneClass = (v: number) =>
  v >= 0 ? 'text-[var(--ov-good)]' : 'text-[var(--ov-bad)]'

function DimensionTable({
  title,
  keyHeader,
  rows,
  loading,
  actions,
  t,
}: {
  title: string
  keyHeader: string
  rows: CostDimensionRow[]
  loading: boolean
  actions?: React.ReactNode
  t: (k: string) => string
}) {
  return (
    <ConsoleCard
      title={title}
      loading={loading}
      actions={actions}
      contentHeight='240px'
      contentClassName='-mx-[17px] mt-3'
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className='pl-[17px]'>{keyHeader}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Revenue')}</TableHead>
            <TableHead className='text-right'>{t('Provider Cost')}</TableHead>
            <TableHead className='pr-[17px] text-right'>
              {t('Margin')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className='text-muted-foreground py-8 text-center'
              >
                {t('No data available')}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((r) => (
              <TableRow
                key={r.key}
                className={cn(r.margin < 0 && 'bg-[var(--ov-bad)]/5')}
              >
                <TableCell className='pl-[17px] font-medium'>
                  {r.label}
                </TableCell>
                <TableCell className='text-right font-mono text-xs tabular-nums'>
                  {count(r.requests)}
                </TableCell>
                <TableCell className='text-right font-mono text-xs tabular-nums'>
                  {money(r.revenue)}
                </TableCell>
                <TableCell className='text-right font-mono text-xs tabular-nums'>
                  {money(r.provider_cost)}
                </TableCell>
                <TableCell
                  className={cn(
                    'pr-[17px] text-right font-mono text-xs font-semibold tabular-nums',
                    toneClass(r.margin)
                  )}
                >
                  {money(r.margin)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </ConsoleCard>
  )
}

interface FinanceDimensionsProps {
  startTimestamp: number
  endTimestamp: number
}

// Per-model and per-channel revenue/cost/margin breakdown, aligned to the same
// time window as the finance charts above. Finance summary/trend answers "how
// much"; these tables answer "from which model / which channel", so margin can
// be traced to its source (loss-making rows highlighted).
export function FinanceDimensions(props: FinanceDimensionsProps) {
  const { t } = useTranslation()

  // 双视图。模型组 = 同一模型跨上游的高可用聚类，组名即规范模型名——所以
  // "按模型组"就是按模型看成本(默认)。第二视图按 logs.model_name 聚合:路由
  // 流量的 model_name 是方案别名(auto)，故其真实语义是"按方案"(直连流量无
  // 方案，回落显示模型名)。
  const [modelDimension, setModelDimension] = useState<'group' | 'model'>(
    'group'
  )

  const range = useMemo(
    () => ({ start: props.startTimestamp, end: props.endTimestamp }),
    [props.startTimestamp, props.endTimestamp]
  )

  const modelQuery = useQuery({
    queryKey: ['dashboard', 'finance', 'by-model', modelDimension, range],
    queryFn: () => getCostByModel({ ...range, dimension: modelDimension }),
    select: (res) => (res.success ? (res.data ?? []) : []),
    staleTime: 60_000,
  })

  const channelQuery = useQuery({
    queryKey: ['dashboard', 'finance', 'by-channel', range],
    queryFn: () => getCostByChannel(range),
    select: (res) => (res.success ? (res.data ?? []) : []),
    staleTime: 60_000,
  })

  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <DimensionTable
        title={t('Revenue by Model')}
        keyHeader={
          modelDimension === 'group' ? t('Model Group') : t('Request scheme')
        }
        rows={modelQuery.data ?? []}
        loading={modelQuery.isLoading}
        actions={
          <Tabs
            value={modelDimension}
            onValueChange={(v) => setModelDimension(v as 'group' | 'model')}
          >
            <TabsList>
              <TabsTrigger value='group' className='px-2.5 text-xs'>
                {t('By Model Group')}
              </TabsTrigger>
              <TabsTrigger value='model' className='px-2.5 text-xs'>
                {t('By Scheme')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
        t={t}
      />
      <DimensionTable
        title={t('Revenue by Channel')}
        keyHeader={t('Channel')}
        rows={channelQuery.data ?? []}
        loading={channelQuery.isLoading}
        t={t}
      />
    </div>
  )
}
