/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Pencil, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SystemStatus } from '@/features/auth/types'
import { ROLE } from '@/lib/roles'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { useStatus } from '@/hooks/use-status'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateApiRequestAddress } from '../api'
import { useApiKeys } from './api-keys-provider'

/**
 * Resolve the request base URL from status: prefer the dedicated
 * `api_request_address`, fall back to `server_address`, then the origin.
 * Empty strings count as unset so a fresh deployment keeps showing the
 * server address.
 */
function extractApiRequestAddress(status: SystemStatus | null): string {
  const fromApiAddress =
    status?.api_request_address ?? status?.data?.api_request_address
  if (fromApiAddress && typeof fromApiAddress === 'string')
    return fromApiAddress
  const fromServerAddress =
    status?.server_address ??
    (status?.serverAddress as string | undefined) ??
    status?.data?.server_address ??
    (status?.data as Record<string, unknown> | undefined)?.serverAddress
  if (fromServerAddress && typeof fromServerAddress === 'string')
    return fromServerAddress
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function ApiKeysHero() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { setOpen } = useApiKeys()
  const queryClient = useQueryClient()
  const role = useAuthStore((s) => s.auth.user?.role ?? 0)
  const isAdmin = role >= ROLE.ADMIN

  const baseUrl = extractApiRequestAddress(status)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(baseUrl)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  const startEditing = () => {
    setDraft(baseUrl)
    setEditing(true)
  }

  const handleCopy = async () => {
    const ok = await copyToClipboard(baseUrl)
    if (ok) {
      setCopied(true)
      toast.success(t('Copied'))
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleSave = async () => {
    const value = draft.trim()
    if (!value) {
      toast.error(t('Request URL cannot be empty'))
      return
    }
    setSaving(true)
    try {
      const res = await updateApiRequestAddress(value)
      if (res.success) {
        toast.success(t('Request URL updated'))
        setEditing(false)
        await queryClient.invalidateQueries({ queryKey: ['status'] })
      } else {
        toast.error(res.message || t('Failed to update request URL'))
      }
    } catch {
      toast.error(t('Failed to update request URL'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className='bg-card relative overflow-hidden rounded-2xl border p-6 shadow-xs sm:p-7'>
      {/* Subtle brand glow, top-left — theme-aware via the primary token. */}
      <div
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at top left, color-mix(in srgb, var(--primary) 13%, transparent), transparent 42%)',
        }}
      />

      <div className='relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between'>
        {/* Left: security note + create CTA (page title lives in the header) */}
        <div className='max-w-xl'>
          <p className='text-muted-foreground text-sm leading-7'>
            {t(
              'API keys are long-lived. Keep them private, never expose them in shared environments, and rotate them regularly to avoid unauthorized use.'
            )}
          </p>
          <Button
            onClick={() => setOpen('create')}
            className='mt-5 h-11 gap-2 rounded-full px-6 text-sm font-medium'
          >
            <Plus className='size-4' />
            {t('Create API Key')}
          </Button>
        </div>

        {/* Right: request base URL (copy + admin inline edit) */}
        <div className='shrink-0'>
          <div className='text-muted-foreground text-sm font-medium'>
            {t('Request URL')}{' '}
            <span className='text-muted-foreground/70'>(Base URL)</span>
          </div>
          <div className='mt-2 flex flex-wrap items-center gap-2'>
            {editing ? (
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') {
                    setEditing(false)
                    setDraft(baseUrl)
                  }
                }}
                className='h-11 w-[min(360px,70vw)] text-base lg:min-w-[320px]'
              />
            ) : (
              <div className='bg-muted min-w-0 rounded-lg border px-4 py-2.5 lg:min-w-[320px]'>
                <span className='block truncate text-base font-semibold tracking-tight'>
                  {baseUrl}
                </span>
              </div>
            )}

            {!editing && (
              <Button
                variant='outline'
                size='icon'
                className='size-10 shrink-0 rounded-xl'
                onClick={handleCopy}
                aria-label={t('Copy request URL')}
              >
                {copied ? (
                  <Check className='size-4 text-emerald-600' />
                ) : (
                  <Copy className='size-4' />
                )}
              </Button>
            )}

            {isAdmin &&
              (editing ? (
                <div className='flex items-center gap-1.5'>
                  <Button
                    size='sm'
                    className='h-11'
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving && <Loader2 className='size-3.5 animate-spin' />}
                    {t('Save')}
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    className='h-11'
                    onClick={() => {
                      setEditing(false)
                      setDraft(baseUrl)
                    }}
                    disabled={saving}
                  >
                    {t('Cancel')}
                  </Button>
                </div>
              ) : (
                <Button
                  variant='outline'
                  size='icon'
                  className='size-10 shrink-0 rounded-xl'
                  onClick={startEditing}
                  aria-label={t('Edit')}
                >
                  <Pencil className='size-4' />
                </Button>
              ))}
          </div>
          {isAdmin && !editing && (
            <p className='text-muted-foreground mt-2 text-[11px]'>
              {t('Admin only')}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
