/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  formatUseTime,
  formatLogQuota,
  formatTimestampToDate,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DataTableColumnHeader } from '@/components/data-table'
import {
  StatusBadge,
  textColorMap,
  type StatusVariant,
} from '@/components/status-badge'
import { LOG_TYPE_ALL_VALUE } from '../../constants'
import type { UsageLog } from '../../data/schema'
import {
  formatModelName,
  getFirstResponseTimeColor,
  getResponseTimeColor,
  parseLogOther,
} from '../../lib/format'
import {
  isDisplayableLogType,
  isTimingLogType,
  getLogTypeConfig,
} from '../../lib/utils'
import { LogDetailsDialog } from '../dialogs/log-details-dialog'
import { useUsageLogsContext } from '../usage-logs-provider'

function splitQuotaDisplay(value: string): { prefix: string; amount: string } {
  const match = value.match(/^([^0-9+\-.,\s]+)(.+)$/)
  if (!match) return { prefix: '', amount: value }
  return { prefix: match[1], amount: match[2] }
}

/** Column header with a small info icon that reveals a hint on hover. */
function HeaderHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span className='inline-flex items-center gap-1'>
      {label}
      <TooltipProvider delay={100}>
        <Tooltip>
          <TooltipTrigger
            render={<span className='inline-flex cursor-default' />}
          >
            <CircleAlert className='text-muted-foreground/70 size-3.5' />
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  )
}

export function useCommonLogsColumns(isAdmin: boolean): ColumnDef<UsageLog>[] {
  const { t } = useTranslation()
  const columns: ColumnDef<UsageLog>[] = [
    {
      accessorKey: 'created_at',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Time')} />
      ),
      cell: ({ row }) => {
        const timestamp = row.getValue('created_at') as number
        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {formatTimestampToDate(timestamp)}
          </span>
        )
      },
      filterFn: (row, _id, value) => {
        if (!Array.isArray(value) || value.length === 0) return true
        if (value.includes(LOG_TYPE_ALL_VALUE)) return true
        return value.includes(String(row.original.type))
      },
      enableHiding: false,
      meta: { label: t('Time') },
    },
    {
      id: 'status',
      accessorFn: (row) => row.type,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Status')} />
      ),
      cell: ({ row }) => {
        const config = getLogTypeConfig(row.original.type)
        return (
          <span className={cn(textColorMap[config.color as StatusVariant])}>
            {t(config.label)}
          </span>
        )
      },
      meta: { label: t('Status') },
    },
  ]

  if (isAdmin) {
    columns.push(
      {
        id: 'channel',
        accessorFn: (row) => row.channel,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('Channel')} />
        ),
        cell: function ChannelCell({ row }) {
          const log = row.original

          if (!isDisplayableLogType(log.type)) return null

          const other = parseLogOther(log.other)
          const affinity = other?.admin_info?.channel_affinity
          const useChannel = other?.admin_info?.use_channel
          const channelChain =
            useChannel && useChannel.length > 0
              ? useChannel.join(' → ')
              : undefined
          const channelDisplay = log.channel_name
            ? `${log.channel_name} #${log.channel}`
            : `#${log.channel}`
          const channelIdDisplay = `#${log.channel}`

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className='block max-w-[220px] truncate [font-family:var(--font-body)]' />
                  }
                >
                  {log.channel_name || channelIdDisplay}
                </TooltipTrigger>
                <TooltipContent>
                  <div className='space-y-1'>
                    <p>{channelDisplay}</p>
                    {channelChain && (
                      <p className='text-muted-foreground text-xs'>
                        {t('Chain')}: {channelChain}
                      </p>
                    )}
                    {affinity && (
                      <div className='border-t pt-1 text-xs'>
                        <p className='font-medium'>{t('Channel Affinity')}</p>
                        <p>
                          {t('Rule')}: {affinity.rule_name || '-'}
                        </p>
                        <p>
                          {t('Group')}:{' '}
                          {affinity.using_group ||
                            affinity.selected_group ||
                            '-'}
                        </p>
                      </div>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        },
        meta: { label: t('Channel') },
      },
      {
        id: 'user',
        accessorFn: (row) => row.username,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t('User')} />
        ),
        cell: function UserCell({ row }) {
          const { setSelectedUserId, setUserInfoDialogOpen } =
            useUsageLogsContext()
          const log = row.original

          if (!log.username) return null

          const userName = (
            <TooltipProvider delay={300}>
              <Tooltip>
                <TooltipTrigger
                  render={<span className='max-w-[120px] truncate' />}
                >
                  {log.username}
                </TooltipTrigger>
                {log.username.length > 12 && (
                  <TooltipContent side='top'>{log.username}</TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )

          // user_id 仅管理端下发。用户侧看自己的日志时没有该字段,此时降级为
          // 纯文本 —— 否则点击会打开一个 id 为空的用户详情弹窗。
          if (log.user_id == null) {
            return <div className='flex items-center'>{userName}</div>
          }

          const userId = log.user_id

          return (
            <button
              type='button'
              className='flex items-center text-left'
              onClick={(e) => {
                e.stopPropagation()
                setSelectedUserId(userId)
                setUserInfoDialogOpen(true)
              }}
            >
              <TooltipProvider delay={300}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className='max-w-[120px] truncate hover:underline' />
                    }
                  >
                    {log.username}
                  </TooltipTrigger>
                  {log.username.length > 12 && (
                    <TooltipContent side='top'>{log.username}</TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            </button>
          )
        },
        meta: { label: t('User') },
      }
    )
  }

  // 模型列仅管理员可见:普通用户的模型维度由用量页的「模型调用分布」环图承担
  // (逐行模型名对用户是噪声,聚合分布才是信息)。必须是「不注册该列」而不是
  // columnVisibility 默认隐藏 —— 后者能被用户从列显示菜单重新打开。
  // 注:服务端按模型筛选(URL 的 model 参数)不受影响,仍对普通用户可用。
  if (isAdmin) {
    columns.push({
      accessorKey: 'strategy',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Model')} />
      ),
      cell: function ModelCell({ row }) {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const modelInfo = formatModelName(log, isAdmin)

        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {modelInfo.name}
          </span>
        )
      },
      meta: { label: t('Model'), mobileTitle: true },
    })
  }

  columns.push(
    {
      accessorKey: 'use_time',
      header: () => <HeaderHint label={t('Latency')} hint={t('TTFT')} />,
      cell: ({ row }) => {
        const log = row.original
        if (!isTimingLogType(log.type)) return null

        const useTime = row.getValue('use_time') as number
        const other = parseLogOther(log.other)
        const frt = other?.frt
        const hasFrt = log.is_stream && frt != null && frt > 0
        const latencySec = hasFrt ? frt / 1000 : useTime
        const variant = hasFrt
          ? getFirstResponseTimeColor(latencySec)
          : getResponseTimeColor(useTime, log.completion_tokens)

        return (
          <span
            className={cn(
              '[font-family:var(--font-body)] tabular-nums',
              textColorMap[variant as StatusVariant]
            )}
          >
            {formatUseTime(latencySec)}
          </span>
        )
      },
      meta: { label: t('Latency') },
    },

    {
      accessorKey: 'prompt_tokens',
      header: () => (
        <HeaderHint label={t('Usage')} hint={t('Input (cache hit) / Output')} />
      ),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const other = parseLogOther(log.other)
        const promptTokens = log.prompt_tokens || 0
        const completionTokens = log.completion_tokens || 0
        if (promptTokens === 0 && completionTokens === 0) {
          return <span className='text-muted-foreground'>-</span>
        }

        const cacheReadTokens = other?.cache_tokens || 0

        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {promptTokens.toLocaleString()}
            <span className='text-muted-foreground'>
              （{cacheReadTokens.toLocaleString()}）
            </span>
            {' / '}
            {completionTokens.toLocaleString()}
          </span>
        )
      },
      meta: { label: t('Usage') },
    },

    {
      accessorKey: 'quota',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Cost')} />
      ),
      cell: ({ row }) => {
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const quota = row.getValue('quota') as number
        const other = parseLogOther(log.other)
        const isSubscription = other?.billing_source === 'subscription'

        if (isSubscription) {
          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <StatusBadge
                      label={t('Subscription')}
                      variant='success'
                      size='sm'
                      copyable={false}
                      className='cursor-help'
                    />
                  }
                />
                <TooltipContent>
                  <span>
                    {t('Deducted by subscription')}: {formatLogQuota(quota)}
                  </span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }

        const quotaStr = formatLogQuota(quota)
        const quotaDisplay = splitQuotaDisplay(quotaStr)

        return (
          <span className='[font-family:var(--font-body)] tabular-nums'>
            {quotaDisplay.prefix && (
              <span className='mr-0.5'>{quotaDisplay.prefix}</span>
            )}
            {quotaDisplay.amount}
          </span>
        )
      },
      meta: { label: t('Cost') },
    },
    {
      id: 'actions',
      header: () => t('Actions'),
      cell: function ActionsCell({ row }) {
        const [open, setOpen] = useState(false)
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        return (
          <>
            <Button
              type='button'
              variant='link'
              size='sm'
              className='text-primary h-auto p-0 font-normal'
              onClick={(e) => {
                e.stopPropagation()
                setOpen(true)
              }}
            >
              {t('Details')}
            </Button>
            <LogDetailsDialog
              log={log}
              isAdmin={isAdmin}
              open={open}
              onOpenChange={setOpen}
            />
          </>
        )
      },
      enableHiding: false,
      meta: { label: t('Actions') },
    }
  )

  return columns
}
