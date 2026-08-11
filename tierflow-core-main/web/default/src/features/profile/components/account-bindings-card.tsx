/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Mail, Shield, Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SiGithub, SiWechat, SiLinux } from 'react-icons/si'
import { toast } from 'sonner'
import { IconDiscord } from '@/assets/brand-icons'
import {
  handleGitHubOAuth,
  handleOIDCOAuth,
  handleDiscordOAuth,
  handleLinuxDOOAuth,
} from '@/lib/oauth'
import { useDialogs } from '@/hooks/use-dialog'
import { useStatus } from '@/hooks/use-status'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { OAUTH_BIND_STORAGE_KEY } from '@/features/auth/constants'
import {
  getSelfOAuthBindings,
  unbindCustomOAuth,
  type CustomOAuthBinding,
} from '../api'
import type { UserProfile, BindingItem } from '../types'
import { EmailBindDialog } from './dialogs/email-bind-dialog'
import { TelegramBindDialog } from './dialogs/telegram-bind-dialog'
import { WeChatBindDialog } from './dialogs/wechat-bind-dialog'
import { SettingsCard, SettingsRow } from './list-card'

// ============================================================================
// Account Bindings Card
// ============================================================================

interface AccountBindingsCardProps {
  profile: UserProfile | null
  loading: boolean
  onUpdate: () => void
}

type DialogKey = 'email' | 'wechat' | 'telegram'

export function AccountBindingsCard({
  profile,
  loading: pageLoading,
  onUpdate,
}: AccountBindingsCardProps) {
  const { t } = useTranslation()
  const dialogs = useDialogs<DialogKey>()
  const { status, loading: statusLoading } = useStatus()
  const [customBindings, setCustomBindings] = useState<CustomOAuthBinding[]>([])
  const [unbindTarget, setUnbindTarget] = useState<CustomOAuthBinding | null>(
    null
  )
  const [unbinding, setUnbinding] = useState(false)

  const customProviders = status?.custom_oauth_providers as
    | Array<{ id: string; name: string }>
    | undefined

  const fetchCustomBindings = useCallback(async () => {
    if (!customProviders || customProviders.length === 0) return
    try {
      const res = await getSelfOAuthBindings()
      if (res.success && res.data) {
        setCustomBindings(res.data)
      }
    } catch {
      // ignore
    }
  }, [customProviders])

  useEffect(() => {
    fetchCustomBindings()
  }, [fetchCustomBindings])

  const handleUnbindCustom = async () => {
    if (!unbindTarget) return
    setUnbinding(true)
    try {
      const res = await unbindCustomOAuth(unbindTarget.provider_id)
      if (res.success) {
        toast.success(
          t('Unbound {{provider}}', {
            provider: unbindTarget.provider_name,
          })
        )
        await fetchCustomBindings()
        onUpdate()
      } else {
        toast.error(res.message || t('Unbind failed'))
      }
    } catch {
      toast.error(t('Unbind failed'))
    } finally {
      setUnbinding(false)
      setUnbindTarget(null)
    }
  }

  const handleBindCustomOAuth = (provider: { id: string; name: string }) => {
    const redirectUrl = `${window.location.origin}/oauth/${provider.id}?bind=true`
    window.location.href = `/api/oauth/${provider.id}?redirect=${encodeURIComponent(redirectUrl)}`
  }

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== OAUTH_BIND_STORAGE_KEY || !event.newValue) return
      try {
        const payload = JSON.parse(event.newValue) as {
          status?: string
          provider?: string
          timestamp?: number
        }
        if (payload?.status === 'success') {
          onUpdate()
        }
      } catch {
        // ignore malformed payloads
      }
      try {
        window.localStorage.removeItem(OAUTH_BIND_STORAGE_KEY)
      } catch {
        // ignore cleanup failure
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [onUpdate])

  // Memoize bindings to prevent unnecessary recalculations
  const bindings: BindingItem[] = useMemo(() => {
    if (!profile || !status) return []

    return [
      {
        id: 'email',
        label: t('Email'),
        icon: Mail,
        value: profile.email,
        isBound: Boolean(profile.email),
        isEnabled: true,
        onBind: () => dialogs.open('email'),
      },
      {
        id: 'wechat',
        label: t('WeChat'),
        icon: SiWechat as React.ComponentType<{ className?: string }>,
        value: undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).wechat_id
        ),
        isEnabled: status?.wechat_login || false,
        onBind: () => dialogs.open('wechat'),
      },
      {
        id: 'github',
        label: t('GitHub'),
        icon: SiGithub,
        value: (profile as unknown as Record<string, unknown>).github_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).github_id
        ),
        isEnabled: status?.github_oauth || false,
        onBind: () => {
          if (status?.github_client_id) {
            handleGitHubOAuth(status.github_client_id)
          }
        },
      },
      {
        id: 'discord',
        label: t('Discord'),
        icon: IconDiscord,
        value: (profile as unknown as Record<string, unknown>).discord_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).discord_id
        ),
        isEnabled: status?.discord_oauth || false,
        onBind: () => {
          if (status?.discord_client_id) {
            handleDiscordOAuth(status.discord_client_id)
          }
        },
      },
      {
        id: 'oidc',
        label: t('OIDC'),
        icon: Shield,
        value: (profile as unknown as Record<string, unknown>).oidc_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).oidc_id
        ),
        isEnabled: status?.oidc_enabled || false,
        onBind: () => {
          if (status?.oidc_authorization_endpoint && status?.oidc_client_id) {
            handleOIDCOAuth(
              status.oidc_authorization_endpoint,
              status.oidc_client_id
            )
          }
        },
      },
      {
        id: 'telegram',
        label: t('Telegram'),
        icon: Send,
        value: (profile as unknown as Record<string, unknown>).telegram_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).telegram_id
        ),
        isEnabled: status?.telegram_oauth || false,
        onBind: () => dialogs.open('telegram'),
      },
      {
        id: 'linuxdo',
        label: t('LinuxDO'),
        icon: SiLinux as React.ComponentType<{ className?: string }>,
        value: (profile as unknown as Record<string, unknown>).linux_do_id as
          | string
          | undefined,
        isBound: Boolean(
          (profile as unknown as Record<string, unknown>).linux_do_id
        ),
        isEnabled: status?.linuxdo_oauth || false,
        onBind: () => {
          if (status?.linuxdo_client_id) {
            handleLinuxDOOAuth(status.linuxdo_client_id)
          }
        },
      },
    ].filter((binding) => binding.isEnabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, status, t])

  const showSkeleton = pageLoading || statusLoading || !profile

  return (
    <>
      <SettingsCard
        title={t('Account Bindings')}
        description={t('Manage the sign-in methods bound to your account')}
      >
        {showSkeleton
          ? Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className='py-2.5'>
                <Skeleton className='h-8 w-full' />
              </div>
            ))
          : bindings.map((binding) => (
              <SettingsRow
                key={binding.id}
                icon={binding.icon}
                label={binding.label}
                value={binding.value || t('Not bound')}
                action={
                  <Button
                    variant='outline'
                    size='lg'
                    onClick={binding.onBind}
                    disabled={binding.isBound && binding.id !== 'email'}
                  >
                    {binding.isBound
                      ? binding.id === 'email'
                        ? t('Change')
                        : t('Bound')
                      : t('Bind')}
                  </Button>
                }
              />
            ))}

        {/* Custom OAuth providers — rendered as additional rows */}
        {!showSkeleton &&
          customProviders?.map((provider) => {
            const binding = customBindings.find(
              (b) => b.provider_id === provider.id
            )
            const isBound = !!binding
            return (
              <SettingsRow
                key={provider.id}
                label={provider.name}
                value={
                  isBound ? binding?.external_id || t('Bound') : t('Not bound')
                }
                action={
                  isBound ? (
                    <Button
                      variant='destructive'
                      onClick={() => setUnbindTarget(binding)}
                    >
                      {t('Unbind')}
                    </Button>
                  ) : (
                    <Button
                      variant='outline'
                      onClick={() => handleBindCustomOAuth(provider)}
                    >
                      {t('Bind')}
                    </Button>
                  )
                }
              />
            )
          })}
      </SettingsCard>

      {/* Custom OAuth Unbind Confirmation */}
      <ConfirmDialog
        open={!!unbindTarget}
        onOpenChange={(open) => !open && setUnbindTarget(null)}
        title={t('Confirm Unbind')}
        desc={t(
          'Are you sure you want to unbind {{provider}}? You will no longer be able to log in via this method.',
          {
            provider: unbindTarget?.provider_name || '',
          }
        )}
        confirmText={t('Confirm Unbind')}
        destructive
        handleConfirm={handleUnbindCustom}
        isLoading={unbinding}
      />

      {/* Email Bind Dialog */}
      <EmailBindDialog
        open={dialogs.isOpen('email')}
        onOpenChange={(open) =>
          open ? dialogs.open('email') : dialogs.close('email')
        }
        currentEmail={profile?.email}
        onSuccess={onUpdate}
      />

      {/* WeChat Bind Dialog */}
      <WeChatBindDialog
        open={dialogs.isOpen('wechat')}
        onOpenChange={(open) =>
          open ? dialogs.open('wechat') : dialogs.close('wechat')
        }
        onSuccess={onUpdate}
      />

      {/* Telegram Bind Dialog */}
      {status?.telegram_bot_name && (
        <TelegramBindDialog
          open={dialogs.isOpen('telegram')}
          onOpenChange={(open) =>
            open ? dialogs.open('telegram') : dialogs.close('telegram')
          }
          botName={status.telegram_bot_name as string}
          onSuccess={onUpdate}
        />
      )}
    </>
  )
}
