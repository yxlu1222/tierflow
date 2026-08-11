/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Reply, Send, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { SectionPageLayout } from '@/components/layout'
import { StatusBadge } from '@/components/status-badge'
import {
  adminGetTicketDetail,
  adminReplyTicket,
  adminUpdateTicket,
  getMyTicketDetail,
} from './api'
import {
  TICKET_BOARD_ORDER,
  TICKET_CATEGORIES,
  TICKET_MESSAGES,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_VALUES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from './constants'
import { formatTicketTime } from './lib/format'
import { ticketsQueryKeys } from './lib/query-keys'
import type { TicketDetail, TicketMessage } from './types'

const route = getRouteApi('/_authenticated/tickets/$ticketId')

export function TicketDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { ticketId } = route.useParams()
  const id = Number(ticketId)

  const role = useAuthStore((s) => s.auth.user?.role ?? 0)
  const isAdmin = role >= ROLE.ADMIN
  const scope = isAdmin ? 'admin' : 'self'

  const [reply, setReply] = useState('')
  const [composerOpen, setComposerOpen] = useState(false)
  const [userInfoOpen, setUserInfoOpen] = useState(false)

  const { data, isLoading, isError } = useQuery({
    queryKey: ticketsQueryKeys.detail(scope, id),
    queryFn: async (): Promise<TicketDetail> => {
      const res =
        scope === 'admin'
          ? await adminGetTicketDetail(id)
          : await getMyTicketDetail(id)
      return res.data
    },
    enabled: Number.isFinite(id) && id > 0,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: ticketsQueryKeys.detail(scope, id),
    })
    queryClient.invalidateQueries({ queryKey: ticketsQueryKeys.lists() })
    queryClient.invalidateQueries({ queryKey: ticketsQueryKeys.stats() })
  }

  const replyMutation = useMutation({
    mutationFn: () => adminReplyTicket(id, reply.trim()),
    onSuccess: (res) => {
      if (!res.success) return
      toast.success(t(TICKET_MESSAGES.REPLY_SUCCESS))
      setReply('')
      setComposerOpen(false)
      invalidateAll()
    },
  })

  const updateMutation = useMutation({
    mutationFn: (payload: {
      status?: TicketStatus
      priority?: TicketPriority
    }) => adminUpdateTicket(id, payload),
    onSuccess: (res) => {
      if (!res.success) return
      toast.success(t(TICKET_MESSAGES.STATUS_UPDATED))
      invalidateAll()
    },
  })

  const messages = useMemo(() => data?.messages ?? [], [data])
  const userMessage = useMemo(
    () => messages.find((m) => m.author_role === 'user'),
    [messages]
  )
  const staffReplies = useMemo(
    () => messages.filter((m) => m.author_role === 'admin'),
    [messages]
  )

  if (isLoading) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Ticket')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <Skeleton className='h-8 w-40' />
          <Skeleton className='mt-4 h-64 w-full rounded-2xl' />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  if (isError || !data) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Ticket')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <BackButton
            onClick={() =>
              navigate({ to: isAdmin ? '/tickets' : '/notifications/tickets' })
            }
          />
          <div className='text-muted-foreground ring-foreground/10 rounded-xl py-16 text-center text-sm ring-1'>
            {t('Ticket not found')}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const ticket = data.ticket
  const owner = data.owner

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Ticket')} {ticket.ticket_no}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <BackButton
          onClick={() =>
            navigate({ to: isAdmin ? '/tickets' : '/notifications/tickets' })
          }
        />

        <div className='flex flex-col gap-4'>
          <TicketCard
            ticket={ticket}
            userMessage={userMessage}
            isAdmin={isAdmin}
            ownerName={owner?.username}
            composerOpen={composerOpen}
            updating={updateMutation.isPending}
            hasOwner={Boolean(owner)}
            onReplyToggle={() => setComposerOpen((v) => !v)}
            onUserInfo={() => setUserInfoOpen(true)}
            onStatusChange={(s) => updateMutation.mutate({ status: s })}
            onPriorityChange={(p) => updateMutation.mutate({ priority: p })}
          />

          <StaffReplyCard replies={staffReplies} />

          {isAdmin ? (
            composerOpen && (
              <ReplyComposer
                value={reply}
                onChange={setReply}
                pending={replyMutation.isPending}
                onCancel={() => setComposerOpen(false)}
                onSend={() => reply.trim() && replyMutation.mutate()}
              />
            )
          ) : (
            <div className='text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm'>
              {staffReplies.length > 0
                ? t(
                    'This ticket has been answered. Submit a new ticket for other issues.'
                  )
                : t(
                    'Your feedback has been received. Support will reply soon.'
                  )}
            </div>
          )}
        </div>

        {isAdmin && owner && (
          <UserInfoDialog
            open={userInfoOpen}
            onOpenChange={setUserInfoOpen}
            owner={owner}
          />
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant='ghost' size='sm' className='mb-3 -ml-2' onClick={onClick}>
      <ArrowLeft className='size-4' />
      {t('Back')}
    </Button>
  )
}

interface TicketCardProps {
  ticket: TicketDetail['ticket']
  userMessage?: TicketMessage
  isAdmin: boolean
  ownerName?: string
  composerOpen: boolean
  updating: boolean
  hasOwner: boolean
  onReplyToggle: () => void
  onUserInfo: () => void
  onStatusChange: (s: TicketStatus) => void
  onPriorityChange: (p: TicketPriority) => void
}

/**
 * 工单卡：把工单主体（提交信息 + 状态/优先级/分类 + 主题/详细内容键值）合并成一张卡。
 * 管理端在右上有「用户信息 / 认领 / 回复」操作；用户端为只读。
 */
function TicketCard(props: TicketCardProps) {
  const { t } = useTranslation()
  const { ticket, userMessage, isAdmin } = props
  const status = TICKET_STATUSES[ticket.status]
  const priority = TICKET_PRIORITIES[ticket.priority]
  const category = TICKET_CATEGORIES[ticket.category]

  return (
    <section className='bg-card relative overflow-hidden rounded-2xl border shadow-xs'>
      {/* 品牌微光（与充值 / 账单 / 密钥 hero 同一处理）。 */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at top left, color-mix(in srgb, var(--primary) 12%, transparent), transparent 40%)',
        }}
      />

      {/* 顶部：提交信息 + 操作 */}
      <div className='relative flex items-start gap-3 px-5 pt-4 pb-3.5'>
        <div className='min-w-0 flex-1 text-sm'>
          <span className='text-muted-foreground tabular-nums'>
            {t('Submitted at')} {formatTimestampToDate(ticket.created_at)}
            {isAdmin && props.ownerName ? ` · ${props.ownerName}` : ''}
          </span>
        </div>
        {isAdmin && (
          <div className='flex shrink-0 items-center gap-2'>
            {props.hasOwner && (
              <Button variant='outline' size='sm' onClick={props.onUserInfo}>
                <User className='size-4' />
                {t('User info')}
              </Button>
            )}
            <Button size='sm' onClick={props.onReplyToggle}>
              {props.composerOpen ? (
                t('Collapse')
              ) : (
                <>
                  <Pencil className='size-4' />
                  {t('Reply')}
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* 状态栏：状态 / 优先级（管理端可编辑）/ 分类 */}
      <div className='relative flex flex-wrap items-center gap-x-6 gap-y-2 border-t px-5 py-3 text-sm'>
        <KV label={t('Status')}>
          {isAdmin ? (
            <Select
              value={ticket.status}
              onValueChange={(v) => props.onStatusChange(v as TicketStatus)}
              disabled={props.updating}
            >
              <SelectTrigger className='h-8 min-w-[9rem]'>
                <SelectValue>
                  {status && (
                    <StatusBadge
                      label={t(status.labelKey)}
                      variant={status.variant}
                      showDot={false}
                      copyable={false}
                    />
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TICKET_BOARD_ORDER.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(TICKET_STATUSES[s].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            status && (
              <StatusBadge
                label={t(status.labelKey)}
                variant={status.variant}
                showDot={false}
                copyable={false}
              />
            )
          )}
        </KV>

        <KV label={t('Priority')}>
          {isAdmin ? (
            <Select
              value={ticket.priority}
              onValueChange={(v) => props.onPriorityChange(v as TicketPriority)}
              disabled={props.updating}
            >
              <SelectTrigger className='h-8 min-w-[9rem]'>
                <SelectValue>
                  {priority && (
                    <StatusBadge
                      label={t(priority.labelKey)}
                      variant={priority.variant}
                      showDot={false}
                      copyable={false}
                    />
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITY_VALUES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {t(TICKET_PRIORITIES[p].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            priority && (
              <StatusBadge
                label={t(priority.labelKey)}
                variant={priority.variant}
                showDot={false}
                copyable={false}
              />
            )
          )}
        </KV>

        <KV label={t('Category')}>
          {category ? (
            <StatusBadge
              label={t(category.labelKey)}
              variant='neutral'
              showDot={false}
              copyable={false}
            />
          ) : (
            '—'
          )}
        </KV>
      </div>

      {/* 键值区：主题 / 详细内容 */}
      <div className='relative flex flex-col gap-3.5 border-t px-5 py-4'>
        <Field label={t('Subject')} strong>
          {ticket.title}
        </Field>
        <Field label={t('Issue details')}>{userMessage?.content ?? '—'}</Field>
      </div>
    </section>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='font-medium'>{children}</span>
    </div>
  )
}

function Field({
  label,
  children,
  strong,
}: {
  label: string
  children: React.ReactNode
  strong?: boolean
}) {
  return (
    <div className='flex gap-4 text-sm'>
      <span className='text-muted-foreground w-16 shrink-0'>{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 whitespace-pre-wrap',
          strong ? 'text-foreground font-medium' : 'text-foreground/85'
        )}
      >
        {children}
      </span>
    </div>
  )
}

/** 客服回复卡：一问一答；无回复时显示空态。 */
function StaffReplyCard({ replies }: { replies: TicketMessage[] }) {
  const { t } = useTranslation()
  const latest = replies[replies.length - 1]

  return (
    <section className='bg-card overflow-hidden rounded-2xl'>
      <div className='bg-primary/[0.06] flex items-center gap-2 border-b px-4 py-3 text-sm font-semibold'>
        <span className='bg-info/15 text-info grid size-6 place-items-center rounded-md'>
          <Reply className='size-3.5' />
        </span>
        {t('Reply')}
        {latest && (
          <span className='text-muted-foreground ms-auto text-xs font-normal tabular-nums'>
            {formatTicketTime(latest.created_at)}
          </span>
        )}
      </div>
      {replies.length === 0 ? (
        <div className='text-muted-foreground/70 py-8 text-center text-sm'>
          {t('Awaiting support reply')}
        </div>
      ) : (
        replies.map((r, i) => (
          <div
            key={r.id}
            className={cn(
              'text-foreground/85 px-4 py-3.5 text-sm whitespace-pre-wrap',
              i > 0 && 'border-t'
            )}
          >
            {r.content}
          </div>
        ))
      )}
    </section>
  )
}

interface ReplyComposerProps {
  value: string
  onChange: (v: string) => void
  pending: boolean
  onCancel: () => void
  onSend: () => void
}

/** 管理端回复区：点「回复」在底部展开，单一回复框。 */
function ReplyComposer({
  value,
  onChange,
  pending,
  onCancel,
  onSend,
}: ReplyComposerProps) {
  const { t } = useTranslation()

  return (
    <div className='bg-card rounded-2xl border shadow-xs'>
      <div className='p-3 pb-0'>
        <Textarea
          value={value}
          rows={4}
          autoFocus
          placeholder={t('Write a reply...')}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      <div className='flex items-center gap-2 p-3'>
        <span className='text-muted-foreground me-auto text-xs'>
          {t('The ticket will be marked resolved after you reply')}
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={onCancel}
          disabled={pending}
        >
          {t('Cancel')}
        </Button>
        <Button
          size='sm'
          onClick={onSend}
          disabled={pending || value.trim().length === 0}
        >
          <Send className='size-4' />
          {t('Send reply')}
        </Button>
      </div>
    </div>
  )
}

function UserInfoDialog({
  open,
  onOpenChange,
  owner,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  owner: NonNullable<TicketDetail['owner']>
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>{t('Requester')}</DialogTitle>
        </DialogHeader>
        <div className='flex items-center gap-3'>
          <span
            className='border-border flex size-11 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-sm'
            style={getUserAvatarStyle(owner.username)}
          >
            {getUserAvatarFallback(owner.username)}
          </span>
          <div className='min-w-0'>
            <div className='truncate text-sm font-semibold'>
              {owner.username}
            </div>
            <div className='text-muted-foreground truncate text-xs'>
              {owner.email}
            </div>
          </div>
        </div>
        <div className='flex flex-col'>
          <URow label={t('Group')} value={owner.group} />
          <URow label={t('Balance')} value={formatQuota(owner.quota)} />
          <URow label={t('Used')} value={formatQuota(owner.used_quota)} />
          <URow
            label={t('Joined')}
            value={formatTimestampToDate(owner.created_at)}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function URow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between gap-3 border-t py-2.5 text-sm first:border-t-0'>
      <span className='text-muted-foreground'>{label}</span>
      <span className='truncate font-medium tabular-nums' title={value}>
        {value}
      </span>
    </div>
  )
}
