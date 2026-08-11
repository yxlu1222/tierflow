/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { DownloadIcon, ExternalLinkIcon, RefreshCcwIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { formatTimestamp, formatTimestampToDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Markdown } from '@/components/ui/markdown'
import { SettingsSection } from '../components/settings-section'

type UpdateInfo = {
  current_version: string
  latest_version: string
  has_update: boolean
  name?: string
  notes?: string
  url?: string
  published_at?: string
}

type UpdateCheckerSectionProps = {
  currentVersion?: string | null
  startTime?: number | null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function UpdateCheckerSection({
  currentVersion,
  startTime,
}: UpdateCheckerSectionProps) {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [info, setInfo] = useState<UpdateInfo | null>(null)

  const uptime = startTime ? formatTimestamp(startTime) : t('Unknown')
  const version = currentVersion || t('Unknown')

  const handleCheckUpdates = async () => {
    setChecking(true)
    try {
      const res = await api.get('/api/update/check', { skipBusinessError: true })
      const body = res.data
      if (!body?.success) {
        toast.error(body?.message || t('Failed to check for updates'))
        return
      }
      const data = body.data as UpdateInfo
      if (!data.has_update) {
        toast.success(
          t('You are running the latest version ({{version}}).', {
            version: data.current_version,
          })
        )
        return
      }
      setInfo(data)
      setDialogOpen(true)
    } catch {
      toast.error(t('Failed to check for updates'))
    } finally {
      setChecking(false)
    }
  }

  // 触发更新后,容器会拉新镜像并重启;轮询 /api/status 直到版本变化(用原生 fetch,
  // 重启期间接口会短暂不可达,静默忽略)。
  const pollUntilUpdated = async (fromVersion?: string) => {
    const deadline = Date.now() + 4 * 60 * 1000
    while (Date.now() < deadline) {
      await sleep(3000)
      try {
        const r = await fetch('/api/status', { cache: 'no-store' })
        if (r.ok) {
          const d = await r.json()
          const v: string | undefined = d?.data?.version
          if (v && v !== fromVersion) {
            toast.success(t('Updated to {{version}}.', { version: v }))
            setUpdating(false)
            setDialogOpen(false)
            setTimeout(() => window.location.reload(), 1500)
            return
          }
        }
      } catch {
        // 容器重启中,接口暂时不可达,继续轮询
      }
    }
    setUpdating(false)
    toast.warning(t('Update may still be in progress, please refresh later.'))
  }

  const handlePerformUpdate = async () => {
    setUpdating(true)
    try {
      const res = await api.post(
        '/api/update/perform',
        {},
        { skipBusinessError: true }
      )
      const body = res.data
      if (!body?.success) {
        toast.error(body?.message || t('Failed to start update'))
        setUpdating(false)
        return
      }
      toast.info(t('Update triggered, the service is restarting...'))
      void pollUntilUpdated(info?.current_version || currentVersion || undefined)
    } catch {
      toast.error(t('Failed to start update'))
      setUpdating(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('System maintenance')}>
        <div className='space-y-6'>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Current version')}
              </div>
              <div className='text-lg font-semibold'>{version}</div>
            </div>
            <div className='rounded-lg border p-4'>
              <div className='text-muted-foreground text-sm'>
                {t('Uptime since')}
              </div>
              <div className='text-lg font-semibold'>{uptime}</div>
            </div>
          </div>

          <Button onClick={handleCheckUpdates} disabled={checking || updating}>
            {checking ? (
              t('Checking updates...')
            ) : (
              <>
                <RefreshCcwIcon className='me-2 h-4 w-4' />
                {t('Check for updates')}
              </>
            )}
          </Button>
        </div>
      </SettingsSection>

      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (!updating) setDialogOpen(o)
        }}
      >
        <DialogContent className='max-h-[80vh] overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>
              {info?.latest_version
                ? t('New version available: {{version}}', {
                    version: info.latest_version,
                  })
                : t('Release details')}
            </DialogTitle>
            {info?.published_at && (
              <DialogDescription>
                {t('Published')}{' '}
                {formatTimestampToDate(
                  new Date(info.published_at).getTime(),
                  'milliseconds'
                )}
              </DialogDescription>
            )}
          </DialogHeader>

          <div className='space-y-4'>
            <div className='text-muted-foreground text-sm'>
              {t('Current version')}: {info?.current_version} →{' '}
              {info?.latest_version}
            </div>
            {info?.notes ? (
              <Markdown>{info.notes}</Markdown>
            ) : (
              <p className='text-muted-foreground text-sm'>
                {t('No release notes provided.')}
              </p>
            )}
            {updating && (
              <p className='text-sm font-medium'>
                {t('Update triggered, the service is restarting...')}
              </p>
            )}
          </div>

          <DialogFooter>
            {info?.url && (
              <Button
                type='button'
                variant='secondary'
                onClick={() =>
                  window.open(info.url, '_blank', 'noopener,noreferrer')
                }
                disabled={updating}
              >
                <ExternalLinkIcon className='me-2 h-4 w-4' />
                {t('Open release')}
              </Button>
            )}
            <Button
              type='button'
              variant='secondary'
              onClick={() => setDialogOpen(false)}
              disabled={updating}
            >
              {t('Later')}
            </Button>
            <Button type='button' onClick={handlePerformUpdate} disabled={updating}>
              <DownloadIcon className='me-2 h-4 w-4' />
              {updating ? t('Updating...') : t('Update now')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
