/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 全站模型调用明细。
 *
 * 环图只给得出占比,回答不了「这个模型到底跑了多少次、使用了多少 token」。财务
 * 分区已经有按模型的收入/成本视角,所以这里刻意只看请求数和 token，不重复金额。
 *
 * 口径与同页的「调用模型占比」环图严格一致(共用 `aggregateByHitModelGroup`):内部
 * 优先按命中的模型组聚合；固定本地路由没有模型组时，回退到实际请求模型名。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ConsoleCard>
  )
}
