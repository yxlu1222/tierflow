/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 两个订单表共用的列定义与表格外观常量。
 *
 * 抽出来的是逐字相同的五列(订单号 / 用户 / 状态 / 金额 / 创建时间)—— 此前两表
 * 各写一份,连 `¥{...toFixed(2)}` 的写法都是复制的,改一次货币格式要改两处。
 */
import { type ColumnDef } from '@tanstack/react-table'
import { type TFunction } from 'i18next'
import { formatTimestampToDate } from '@/lib/format'
import { StatusBadge } from '@/components/status-badge'
import { getOrderStatusConfig } from '../constants'

/**
 * 统一的紧凑表格外观(14px 正文、不加粗的 muted 粘性表头)。
 * 与 features/billing 的账单表同一套观感 —— 那里原本是这段字符串的第三份拷贝。
 */
export const ORDER_TABLE_CLASS =
  'overflow-x-auto [&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px] [&_[data-slot=table]_th]:font-normal [&_[data-slot=empty-title]]:!text-xl'

export const ORDER_TABLE_HEADER_CLASS =
  'bg-muted sticky top-0 z-10 [&_th]:text-foreground'

/** 两表共有的订单行字段(结构化子集,便于共享列复用) */
interface CommonOrderRow {
  trade_no: string
  username?: string
  user_id?: number
  status: string
  money: number
  create_time: number
}

/** 用户列的展示值:优先用户名,回落 #id,再回落占位符 */
export function formatOrderUser<T extends CommonOrderRow>(row: T): string {
  return row.username || (row.user_id ? `#${row.user_id}` : '-')
}

export function buildTradeNoColumn<T extends CommonOrderRow>(
  t: TFunction
): ColumnDef<T> {
  return {
    accessorKey: 'trade_no',
    meta: { label: t('Order Number'), mobileTitle: true },
    header: t('Order Number'),
    cell: ({ row }) => (
      <span className='text-foreground tabular-nums'>
        {row.original.trade_no}
      </span>
    ),
  }
}

export function buildUserColumn<T extends CommonOrderRow>(
  t: TFunction
): ColumnDef<T> {
  return {
    accessorKey: 'username',
    meta: { label: t('User') },
    header: t('User'),
    cell: ({ row }) => (
      <span className='max-w-[140px] truncate'>
        {formatOrderUser(row.original)}
      </span>
    ),
  }
}

export function buildStatusColumn<T extends CommonOrderRow>(
  t: TFunction
): ColumnDef<T> {
  return {
    accessorKey: 'status',
    meta: { label: t('Status'), mobileBadge: true },
    header: t('Status'),
    cell: ({ row }) => {
      const cfg = getOrderStatusConfig(row.original.status)
      return (
        <StatusBadge
          label={t(cfg.labelKey)}
          variant={cfg.variant}
          copyable={false}
        />
      )
    },
  }
}

export function buildMoneyColumn<T extends CommonOrderRow>(
  t: TFunction
): ColumnDef<T> {
  return {
    accessorKey: 'money',
    meta: { label: t('Amount') },
    header: t('Amount'),
    cell: ({ row }) => (
      // 全站单币种人民币(CLAUDE.md Rule 8)
      <span className='font-medium tabular-nums'>
        ¥{Number(row.original.money || 0).toFixed(2)}
      </span>
    ),
  }
}

export function buildCreatedAtColumn<T extends CommonOrderRow>(
  t: TFunction
): ColumnDef<T> {
  return {
    accessorKey: 'create_time',
    meta: { label: t('Created At'), mobileHidden: true },
    header: t('Created At'),
    cell: ({ row }) => (
      <span className='whitespace-nowrap tabular-nums'>
        {formatTimestampToDate(row.original.create_time)}
      </span>
    ),
  }
}
