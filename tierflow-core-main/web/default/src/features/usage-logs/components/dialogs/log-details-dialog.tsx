/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import {
  formatLogQuota,
  formatTimestampToDate,
  formatUseTime,
} from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import type { UsageLog } from '../../data/schema'
import {
  formatModelName,
  isViolationFeeLog,
  parseLogOther,
} from '../../lib/format'
import { getLogTypeConfig } from '../../lib/utils'

interface LogDetailsDialogProps {
  log: UsageLog
  isAdmin: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className='text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase'>
        {title}
      </div>
      <div className='divide-border/50 divide-y'>{children}</div>
    </div>
  )
}

function Row({
  label,
  value,
  onCopy,
}: {
  label: string
  value: ReactNode
  onCopy?: () => void
}) {
  return (
    <div className='flex items-center justify-between gap-4 py-2'>
      <span className='text-muted-foreground shrink-0 text-sm [font-family:var(--font-body)]'>
        {label}
      </span>
      <span className='flex min-w-0 items-center gap-1.5 text-sm [font-family:var(--font-body)] tabular-nums'>
        <span className='truncate'>{value}</span>
        {onCopy && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='Copy'
            className='text-muted-foreground hover:text-foreground size-5 shrink-0'
            onClick={onCopy}
          >
            <Copy className='size-3' />
          </Button>
        )}
      </span>
    </div>
  )
}

/**
 * Full detail view for a single log row — grouped into overview, request
 * identifiers, performance, and (when present) content / error sections.
 */
export function LogDetailsDialog({
  log,
  isAdmin,
  open,
  onOpenChange,
}: LogDetailsDialogProps) {
  const { t } = useTranslation()
  const { copyToClipboard } = useCopyToClipboard()
  const other = parseLogOther(log.other)
  const config = getLogTypeConfig(log.type)
  const { name: modelName, routeMeta } = formatModelName(log, isAdmin)

  const useTime = log.use_time
  const frt = other?.frt
  const hasFrt = log.is_stream && frt != null && frt > 0
  const tokensPerSecond =
    useTime > 0 && log.completion_tokens > 0
      ? Math.round(log.completion_tokens / useTime)
      : null

  const group = log.group || other?.group || ''
  const channelText = log.channel_name
    ? `${log.channel_name} #${log.channel}`
    : log.channel
      ? `#${log.channel}`
      : ''

  const isViolation = isViolationFeeLog(other)
  const streamErr =
    log.is_stream &&
    other?.stream_status &&
    other.stream_status.status &&
    other.stream_status.status !== 'ok'
      ? other.stream_status
      : null
  const hasContentSection = !!log.content || isViolation || !!streamErr

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {t('Log Details')}
            <StatusBadge
              label={t(config.label)}
              variant={config.color as StatusBadgeProps['variant']}
              size='sm'
              copyable={false}
            />
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {t('View the complete details for this log entry')}
          </DialogDescription>
        </DialogHeader>

        <div className='max-h-[70vh] space-y-4 overflow-y-auto pr-1'>
          <Section title={t('Overview')}>
            <Row
              label={t('Time')}
              value={formatTimestampToDate(log.created_at)}
            />
            <Row label={t('Model')} value={modelName || '-'} />
            {log.token_name && <Row label={t('Token')} value={log.token_name} />}
            {group && <Row label={t('Group')} value={group} />}
            {isAdmin && log.username && (
              <Row label={t('User')} value={log.username} />
            )}
            {isAdmin && channelText && (
              <Row label={t('Channel')} value={channelText} />
            )}
            {isAdmin && log.ip && (
              <Row
                label={t('IP Address')}
                value={log.ip}
                onCopy={() => copyToClipboard(log.ip)}
              />
            )}
          </Section>

          {/* 路由信息：仅管理员可见（方案别名/tier/真实上游/降级），普通用户彻底抽象上游 */}
          {routeMeta && (
            <Section title={t('Routing')}>
              <Row label={t('Request scheme')} value={routeMeta.alias} />
              {routeMeta.multimodal ? (
                <Row
                  label={t('Tier')}
                  value={t('Multimodal (bypassed scoring)')}
                />
              ) : routeMeta.tier != null && routeMeta.tier > 0 ? (
                <Row label={t('Tier')} value={`tier${routeMeta.tier}`} />
              ) : null}
              {routeMeta.upstream && (
                <Row label={t('Upstream model')} value={routeMeta.upstream} />
              )}
              {routeMeta.degraded && (
                <Row
                  label={t('Route degraded')}
                  value={t('Scoring unavailable, fell back to default tier')}
                />
              )}
            </Section>
          )}

          {(log.request_id || log.upstream_request_id) && (
            <Section title={t('Identifiers')}>
              {log.request_id && (
                <Row
                  label={t('Request ID')}
                  value={log.request_id}
                  onCopy={() => copyToClipboard(log.request_id)}
                />
              )}
              {log.upstream_request_id && (
                <Row
                  label={t('Upstream Request ID')}
                  value={log.upstream_request_id}
                  onCopy={() => copyToClipboard(log.upstream_request_id)}
                />
              )}
            </Section>
          )}

          <Section title={t('Performance')}>
            <Row
              label={t('TTFT')}
              value={formatUseTime(hasFrt ? frt / 1000 : useTime)}
            />
            <Row label={t('Response Time')} value={formatUseTime(useTime)} />
            <Row
              label={t('Throughput short')}
              value={tokensPerSecond != null ? `${tokensPerSecond} t/s` : '-'}
            />
            <Row
              label={t('Streaming')}
              value={log.is_stream ? t('Yes') : t('No')}
            />
          </Section>

          {hasContentSection && (
            <Section title={t('Details')}>
              {isViolation && (
                <>
                  <Row
                    label={t('Violation Fee')}
                    value={other?.violation_fee_code || '-'}
                  />
                  <Row
                    label={t('Fee')}
                    value={formatLogQuota(other?.fee_quota ?? log.quota)}
                  />
                </>
              )}
              {streamErr && (
                <>
                  <Row
                    label={t('Stream Status')}
                    value={streamErr.end_reason || t('Error')}
                  />
                  {(streamErr.error_count ?? 0) > 0 && (
                    <Row
                      label={t('Soft Errors')}
                      value={String(streamErr.error_count)}
                    />
                  )}
                </>
              )}
              {log.content && (
                <div className='text-muted-foreground bg-muted/40 mt-2 rounded-md p-2 text-sm break-all [font-family:var(--font-body)]'>
                  {log.content}
                </div>
              )}
            </Section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
