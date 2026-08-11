/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Power, PowerOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getUserGroups } from '@/lib/api'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { updateApiKeyStatus } from '../api'
import {
  API_KEY_STATUS,
  API_KEY_STATUSES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../constants'
import { ApiKeyCell, IpRestrictionsCell, ModelLimitsCell } from './api-keys-cells'
import { useApiKeys } from './api-keys-provider'

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

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className='flex items-center justify-between gap-4 py-2'>
      <span className='text-muted-foreground shrink-0 text-sm [font-family:var(--font-body)]'>
        {label}
      </span>
      <span className='flex min-w-0 items-center gap-1.5 text-sm tabular-nums [font-family:var(--font-body)]'>
        {value}
      </span>
    </div>
  )
}

export function ApiKeysDetailDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useApiKeys()
  // The user's own pricing group (defaults to `default`). An empty token group
  // resolves to this group on the backend, so we show it as the concrete group.
  const userGroup = useAuthStore((s) => s.auth.user?.group) || 'default'
  const apiKey = currentRow
  const isOpen = open === 'detail' && !!apiKey
  const [toggling, setToggling] = useState(false)

  const { data: groupsRes } = useQuery({
    queryKey: ['user-self-groups'],
    queryFn: getUserGroups,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  })

  if (!apiKey) return null

  const statusConfig = API_KEY_STATUSES[apiKey.status]
  const isEnabled = apiKey.status === API_KEY_STATUS.ENABLED
  const group = apiKey.group || userGroup
  const groupRatio =
    group && group !== 'auto' && groupsRes?.success
      ? groupsRes.data?.[group]?.ratio
      : undefined
  const ratio = typeof groupRatio === 'number' ? groupRatio : undefined

  const used = apiKey.used_quota
  const remaining = apiKey.remain_quota
  const total = used + remaining

  const handleToggle = async () => {
    const next = isEnabled ? API_KEY_STATUS.DISABLED : API_KEY_STATUS.ENABLED
    setToggling(true)
    try {
      const res = await updateApiKeyStatus(apiKey.id, next)
      if (res.success) {
        toast.success(
          isEnabled
            ? t(SUCCESS_MESSAGES.API_KEY_DISABLED)
            : t(SUCCESS_MESSAGES.API_KEY_ENABLED)
        )
        triggerRefresh()
        setOpen(null)
      } else {
        toast.error(res.message || t(ERROR_MESSAGES.STATUS_UPDATE_FAILED))
      }
    } catch {
      toast.error(t(ERROR_MESSAGES.UNEXPECTED))
    } finally {
      setToggling(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && setOpen(null)}>
      <DialogContent className='flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md'>
        <DialogHeader className='border-b px-5 py-4 text-start'>
          <DialogTitle className='flex items-center gap-2'>
            <span className='truncate'>{apiKey.name}</span>
            {statusConfig && (
              <StatusBadge
                label={t(statusConfig.label)}
                variant={statusConfig.variant}
                showDot={false}
                copyable={false}
              />
            )}
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {t('View the complete details for this API key')}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4'>
          <Section title={t('API Key')}>
            <div className='py-1'>
              <ApiKeyCell apiKey={apiKey} />
            </div>
          </Section>

          <Section title={t('Access')}>
            <Row
              label={t('Group')}
              value={
                group === 'auto' ? (
                  <span className='inline-flex items-center gap-1.5'>
                    <GroupBadge group='auto' showDot={false} />
                    {apiKey.cross_group_retry && (
                      <StatusBadge
                        label={t('Cross-group')}
                        variant='info'
                        showDot={false}
                        copyable={false}
                      />
                    )}
                  </span>
                ) : (
                  <GroupBadge group={group} ratio={ratio} showDot={false} />
                )
              }
            />
            <Row
              label={t('Models')}
              value={<ModelLimitsCell apiKey={apiKey} />}
            />
            <Row
              label={t('IP Restriction')}
              value={<IpRestrictionsCell apiKey={apiKey} />}
            />
          </Section>

          <Section title={t('Quota')}>
            {apiKey.unlimited_quota ? (
              <Row label={t('Quota')} value={t('Unlimited')} />
            ) : (
              <>
                <Row label={t('Remaining')} value={formatQuota(remaining)} />
                <Row label={t('Used:')} value={formatQuota(used)} />
                <Row label={t('Total:')} value={formatQuota(total)} />
              </>
            )}
          </Section>

          <Section title={t('Timestamps')}>
            <Row
              label={t('Created')}
              value={formatTimestampToDate(apiKey.created_time)}
            />
            <Row
              label={t('Expires')}
              value={
                apiKey.expired_time === -1
                  ? t('Never')
                  : formatTimestampToDate(apiKey.expired_time)
              }
            />
            <Row
              label={t('Last Used')}
              value={
                apiKey.accessed_time
                  ? formatTimestampToDate(apiKey.accessed_time)
                  : '-'
              }
            />
          </Section>
        </div>

        <div className='bg-muted/50 flex justify-between gap-2 border-t px-5 py-3'>
          <Button
            variant='outline'
            size='sm'
            onClick={handleToggle}
            disabled={toggling}
          >
            {toggling ? (
              <Loader2 className='size-4 animate-spin' />
            ) : isEnabled ? (
              <PowerOff className='size-4' />
            ) : (
              <Power className='size-4' />
            )}
            {isEnabled ? t('Disable') : t('Enable')}
          </Button>
          <DialogClose render={<Button variant='outline' size='sm' />}>
            {t('Close')}
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  )
}
