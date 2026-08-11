/*
Copyright (C) 2023-2026 TierFlow
*/
import { Pencil, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/status-badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  PROVIDER_STATE_META,
  StateBadge,
  StatusDot,
  TONE_TEXT,
} from '@/features/route-monitor/state-meta'
import type { ProviderHealth } from '@/features/route-monitor/types'
import type { ModelGroup } from '../types'
import {
  computeGroupHealth,
  GROUP_HEALTH_LABEL_KEY,
  GROUP_HEALTH_TONE,
  type GroupHealth,
  type MemberHealth,
} from '../lib/group-health'

interface GroupHealthCardsProps {
  groups: ModelGroup[]
  healthByChannel: Map<number, ProviderHealth>
  channelNameById: Map<number, string>
  loading?: boolean
  onSelect: (group: ModelGroup, health: GroupHealth) => void
}

// 空态用一个安静的灰点，其余状态复用路由监控的脉冲点。
function HealthDot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  if (tone === 'muted') {
    return <span className='bg-muted-foreground/40 size-2.5 shrink-0 rounded-full' />
  }
  return <StatusDot tone={tone} />
}

// 花名册里的一个上游：故障转移序号、渠道、该上游侧的模型名（与组名不同时才显示）、实时状态。
function UpstreamRow({
  rank,
  member,
  groupName,
}: {
  rank: number
  member: MemberHealth
  groupName: string
}) {
  const { t } = useTranslation()
  const provider = member.provider
  const tone = provider ? PROVIDER_STATE_META[provider.state].tone : 'muted'
  const label = provider
    ? t(PROVIDER_STATE_META[provider.state].labelKey)
    : t('Disabled')
  // 组名即规范模型名；成员在上游侧的真实模型名可能不同（同一模型、异名），
  // 只在确有差异时显示，避免每行都重复组名。
  const alias =
    member.member.model_name && member.member.model_name !== groupName
      ? member.member.model_name
      : null

  return (
    <div className='border-border/70 flex items-center gap-2 border-t border-dashed py-1.5 first:border-t-0'>
      <span className='text-muted-foreground w-3 shrink-0 text-[10px] font-bold tabular-nums'>
        {rank}
      </span>
      <HealthDot tone={tone} />
      <span className='truncate font-medium' title={member.channelName}>
        {member.channelName}
      </span>
      {alias && (
        <span
          className='text-muted-foreground min-w-0 truncate text-[11px]'
          title={alias}
        >
          {alias}
        </span>
      )}
      <span
        className={cn(
          'ml-auto shrink-0 text-[11px] whitespace-nowrap',
          tone !== 'muted' && TONE_TEXT[tone],
          tone === 'muted' && 'text-muted-foreground'
        )}
      >
        {label}
        {provider && provider.cooldown_left > 0 && ` ${provider.cooldown_left}s`}
      </span>
    </div>
  )
}

function GroupHealthCard({
  group,
  health,
  onSelect,
}: {
  group: ModelGroup
  health: GroupHealth
  onSelect: (group: ModelGroup, health: GroupHealth) => void
}) {
  const { t } = useTranslation()
  const tone = GROUP_HEALTH_TONE[health.state]

  return (
    <button
      type='button'
      onClick={() => onSelect(group, health)}
      className={cn(
        'border-border bg-card hover:border-primary/40 focus-visible:ring-ring flex min-w-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none',
        // 停用的组在路由侧是死的（组缓存只收录启用组），必须一眼可辨
        !group.enabled && 'opacity-55'
      )}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <span className='flex min-w-0 items-center gap-1.5'>
          {/* 组名即规范模型名，保留原始大小写——大写会扭曲模型名本身 */}
          <span className='truncate text-sm font-semibold' title={group.name}>
            {group.name}
          </span>
          {!group.enabled && (
            <span className='border-border text-muted-foreground shrink-0 rounded border px-1 py-px text-[10px] font-medium'>
              {t('Disabled')}
            </span>
          )}
        </span>
        <span
          className={cn(
            'shrink-0 text-xs font-semibold tabular-nums',
            tone !== 'muted' && TONE_TEXT[tone],
            tone === 'muted' && 'text-muted-foreground'
          )}
          title={t(GROUP_HEALTH_LABEL_KEY[health.state])}
        >
          {health.total === 0
            ? t(GROUP_HEALTH_LABEL_KEY.empty)
            : `${health.available}/${health.total}`}
        </span>
      </div>

      {health.members.length > 0 && (
        <div className='flex flex-col text-xs'>
          {health.members.map((m, idx) => (
            <UpstreamRow
              key={`${m.member.channel_id}-${m.member.model_name}-${idx}`}
              rank={idx + 1}
              member={m}
              groupName={group.name}
            />
          ))}
        </div>
      )}
    </button>
  )
}

export function GroupHealthCards({
  groups,
  healthByChannel,
  channelNameById,
  loading,
  onSelect,
}: GroupHealthCardsProps) {
  if (loading && groups.length === 0) {
    return (
      <div className='grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4'>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className='border-border flex flex-col gap-2.5 rounded-xl border p-3'
          >
            <Skeleton className='h-4 w-28 rounded' />
            <Skeleton className='h-3 w-full rounded' />
            <Skeleton className='h-3 w-4/5 rounded' />
          </div>
        ))}
      </div>
    )
  }

  if (groups.length === 0) return null

  return (
    <div className='grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4'>
      {groups.map((g) => (
        <GroupHealthCard
          key={g.id}
          group={g}
          health={computeGroupHealth(g, healthByChannel, channelNameById)}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

interface GroupHealthDetailDialogProps {
  group: ModelGroup | null
  health: GroupHealth | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (group: ModelGroup) => void
  onToggleEnabled: (group: ModelGroup) => void
  onDelete: (group: ModelGroup) => void
  toggling?: boolean
}

export function GroupHealthDetailDialog({
  group,
  health,
  open,
  onOpenChange,
  onEdit,
  onToggleEnabled,
  onDelete,
  toggling,
}: GroupHealthDetailDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            {group?.name}
            {group && !group.enabled && (
              <StatusBadge
                variant='neutral'
                size='sm'
                copyable={false}
                label={t('Disabled')}
              />
            )}
          </DialogTitle>
          <DialogDescription>
            {group?.description || (
              <>
                {t(
                  'Live status of every (channel, model) member. A channel that is disabled or cooling down is not routable right now.'
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {!health || health.members.length === 0 ? (
          <p className='text-muted-foreground rounded-lg border py-8 text-center text-sm'>
            {t('No members yet. Add a (channel, model) pair.')}
          </p>
        ) : (
          <div className='overflow-x-auto rounded-lg border [&_td]:py-2.5'>
            <Table>
              <TableHeader className='bg-muted'>
                <TableRow>
                  <TableHead>{t('Channel')}</TableHead>
                  <TableHead>{t('Model')}</TableHead>
                  <TableHead>{t('State')}</TableHead>
                  <TableHead>{t('Cooldown Left')}</TableHead>
                  <TableHead>{t('Keys (available/total)')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.members.map((m, idx) => {
                  const provider = m.provider
                  const availableKeys = provider
                    ? provider.total_keys - provider.cooling_keys
                    : 0
                  return (
                    <TableRow key={`${m.member.channel_id}-${m.member.model_name}-${idx}`}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <span className='font-medium'>{m.channelName}</span>
                          <span className='text-muted-foreground text-xs'>
                            #{m.member.channel_id}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className='font-mono text-xs'>
                        {m.member.model_name}
                      </TableCell>
                      <TableCell>
                        {provider ? (
                          <StateBadge meta={PROVIDER_STATE_META[provider.state]} />
                        ) : (
                          <span className='border-border text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium'>
                            <span className='bg-muted-foreground/40 size-2.5 rounded-full' />
                            {t('Disabled')}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {provider && provider.cooldown_left > 0 ? (
                          <span className={cn('font-mono text-xs font-semibold', TONE_TEXT.bad)}>
                            {provider.cooldown_left}s
                          </span>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {provider ? (
                          <span className='text-muted-foreground text-xs tabular-nums'>
                            {availableKeys}/{provider.total_keys}
                          </span>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {group && (
          <DialogFooter className='sm:justify-between'>
            <Button
              variant='ghost'
              onClick={() => onDelete(group)}
              className='text-destructive hover:text-destructive hover:bg-destructive/10'
            >
              <Trash2 className='size-4' />
              {t('Delete')}
            </Button>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                onClick={() => onToggleEnabled(group)}
                disabled={toggling}
              >
                {group.enabled ? (
                  <ToggleLeft className='size-4' />
                ) : (
                  <ToggleRight className='size-4' />
                )}
                {group.enabled ? t('Disable') : t('Enable')}
              </Button>
              <Button onClick={() => onEdit(group)}>
                <Pencil className='size-4' />
                {t('Edit')}
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
