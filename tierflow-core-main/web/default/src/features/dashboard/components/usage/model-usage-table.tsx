/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 全站模型调用明细。
 *
 * 环图只给得出占比,回答不了「这个模型到底跑了多少次、烧了多少 token」。财务
 * 分区已经有按模型的收入/成本视角,所以这里刻意只看用量口径(请求数 / token /
 * 消耗),不重复钱的维度。
 *
 * 口径与同页的「调用模型占比」环图严格一致(共用 `aggregateByHitModelGroup`):内部
 * 按命中的模型组聚合、对外只称「模型」,未经模型组路由的流量整行丢弃 —— 既不回落成
 * 请求方案名(会在模型列里混进别的层),也不单列一行(会把路由内部状态摆给用户看)。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber, formatQuota } from '@/lib/format'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { aggregateByHitModelGroup } from '@/features/dashboard/lib/hit-model-group'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { ConsoleCard } from '../overview/console-card'

interface ModelUsageTableProps {
  data: QuotaDataItem[]
  loading?: boolean
  isEmpty?: boolean
}

export function ModelUsageTable(props: ModelUsageTableProps) {
  const { t } = useTranslation()

  const rows = useMemo(() => aggregateByHitModelGroup(props.data), [props.data])

  const totalCount = rows.reduce((acc, r) => acc + r.count, 0)

  return (
    <ConsoleCard
      title={t('Model Call Breakdown')}
      caption={t('Ranked by request count')}
      loading={props.loading}
      empty={props.isEmpty || rows.length === 0}
      contentHeight='220px'
      contentClassName='overflow-x-auto'
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('Model')}</TableHead>
            <TableHead className='text-right'>{t('Requests')}</TableHead>
            <TableHead className='text-right'>{t('Share')}</TableHead>
            <TableHead className='text-right'>{t('Total Tokens')}</TableHead>
            <TableHead className='text-right'>
              {t('Total Consumption')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatNumber(row.count)}
              </TableCell>
              <TableCell className='text-muted-foreground text-right tabular-nums'>
                {totalCount > 0
                  ? `${((row.count / totalCount) * 100).toFixed(1)}%`
                  : '—'}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatNumber(row.tokens)}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {formatQuota(row.quota)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ConsoleCard>
  )
}
