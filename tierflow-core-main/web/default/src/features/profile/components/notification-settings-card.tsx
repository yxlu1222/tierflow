/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getCurrencyLabel } from '@/lib/currency'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { updateUserSettings } from '../api'
import { DEFAULT_QUOTA_WARNING_THRESHOLD } from '../constants'
import { parseUserSettings } from '../lib'
import type { UserProfile, UserSettings } from '../types'
import { SettingsCard } from './list-card'

// ============================================================================
// Notification Settings Card
// ============================================================================

interface NotificationSettingsCardProps {
  profile: UserProfile | null
  onUpdate: () => void
}

export function NotificationSettingsCard({
  profile,
  onUpdate,
}: NotificationSettingsCardProps) {
  const { t } = useTranslation()
  const isAdmin = (profile?.role ?? 0) >= ROLE.ADMIN
  const [loading, setLoading] = useState(false)
  // The warning threshold is stored as quota units for the backend, but shown
  // to the user in the configured display currency (e.g. USD/CNY). This local
  // string mirrors the input so editing decimals stays stable.
  const currencyLabel = getCurrencyLabel()
  const [thresholdInput, setThresholdInput] = useState(() =>
    String(quotaUnitsToDollars(DEFAULT_QUOTA_WARNING_THRESHOLD))
  )
  const [settings, setSettings] = useState<UserSettings>({
    notify_type: 'email',
    quota_warning_threshold: DEFAULT_QUOTA_WARNING_THRESHOLD,
    webhook_url: '',
    webhook_secret: '',
    bark_url: '',
    gotify_url: '',
    gotify_token: '',
    gotify_priority: 5,
    accept_unset_model_ratio_model: false,
    record_ip_log: false,
    upstream_model_update_notify_enabled: false,
  })

  // Update form field helper
  const updateField = useCallback(
    <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  useEffect(() => {
    if (profile?.setting) {
      const parsed = parseUserSettings(profile.setting)
      const thresholdQuota =
        parsed.quota_warning_threshold ?? DEFAULT_QUOTA_WARNING_THRESHOLD
      // The profile is loaded asynchronously; synchronize the editable form
      // when the persisted settings arrive.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThresholdInput(String(quotaUnitsToDollars(thresholdQuota)))
      setSettings({
        // Email is the only supported notification method; other transports
        // (webhook/bark/gotify) were removed from the UI. Any previously
        // stored transport fields are preserved and round-tripped on save.
        notify_type: 'email',
        quota_warning_threshold: thresholdQuota,
        webhook_url: parsed.webhook_url ?? '',
        webhook_secret: parsed.webhook_secret ?? '',
        bark_url: parsed.bark_url ?? '',
        gotify_url: parsed.gotify_url ?? '',
        gotify_token: parsed.gotify_token ?? '',
        gotify_priority: parsed.gotify_priority ?? 5,
        accept_unset_model_ratio_model:
          parsed.accept_unset_model_ratio_model || false,
        record_ip_log: parsed.record_ip_log || false,
        upstream_model_update_notify_enabled:
          parsed.upstream_model_update_notify_enabled || false,
      })
    }
  }, [profile])

  const handleSave = async () => {
    try {
      setLoading(true)
      const response = await updateUserSettings(settings)

      if (response.success) {
        toast.success(t('Settings updated successfully'))
        onUpdate()
      } else {
        toast.error(response.message || t('Failed to update settings'))
      }
    } catch (_error) {
      toast.error(t('Failed to update settings'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsCard
      title={t('Notifications')}
      description={t('Configure inference quota alerts for this appliance')}
      action={
        <Button size='lg' onClick={handleSave} disabled={loading}>
          {loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {loading ? t('Saving...') : t('Save Settings')}
        </Button>
      }
    >
      <div>
        {/* 接收邮箱 —— 固定为账号绑定邮箱,不再单独配置 */}
        <div className='space-y-1.5 py-2.5'>
          <span className='text-foreground text-[15px] font-medium'>
            {t('Recipient Email')}
          </span>
          <div>
            {profile?.email ? (
              <>
                <div className='text-muted-foreground text-[15px]'>
                  {profile.email}
                </div>
                <p className='text-muted-foreground mt-1.5 text-sm'>
                  {t('Notifications are sent to your account email.')}
                </p>
              </>
            ) : (
              <div className='text-[15px]'>
                <span className='text-amber-600'>
                  {t('No email bound yet')}
                </span>
                <p className='text-muted-foreground mt-1.5 text-sm'>
                  {t(
                    'Bind an email in Account Bindings below, otherwise notifications cannot be delivered.'
                  )}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Warning Threshold — entered as a currency amount, stored as quota */}
        <div className='space-y-1.5 py-2.5'>
          <Label
            htmlFor='threshold'
            className='text-foreground text-[15px] font-medium'
          >
            {t('Inference Quota Warning Threshold')}
          </Label>
          <div>
            <div className='relative'>
              <Input
                id='threshold'
                type='number'
                min='0'
                step='any'
                className='h-9 pr-14'
                value={thresholdInput}
                onChange={(e) => {
                  const next = e.target.value
                  setThresholdInput(next)
                  updateField(
                    'quota_warning_threshold',
                    next === '' ? 0 : parseQuotaFromDollars(Number(next))
                  )
                }}
                placeholder={t('Enter amount in {{currency}}', {
                  currency: currencyLabel,
                })}
              />
              <span className='text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs'>
                {currencyLabel}
              </span>
            </div>
            <p className='text-muted-foreground mt-1.5 text-sm'>
              {t(
                'Get notified when your remaining inference quota falls below this amount'
              )}
            </p>
          </div>
        </div>

        {/* Upstream model update notifications (admin only) */}
        {isAdmin && (
          <div className='flex items-center justify-between gap-4 py-2.5'>
            <Label
              htmlFor='upstreamModelUpdateNotify'
              className='text-foreground text-[15px] font-medium'
            >
              {t('Receive Upstream Model Update Notifications')}
            </Label>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Only available for admins. When enabled, you will receive a summary notification via your selected method when the scheduled model check detects upstream model changes or check failures.'
              )}
            </p>
            <Switch
              id='upstreamModelUpdateNotify'
              className='shrink-0 justify-self-start sm:justify-self-end'
              checked={settings.upstream_model_update_notify_enabled}
              onCheckedChange={(checked) =>
                updateField('upstream_model_update_notify_enabled', checked)
              }
            />
          </div>
        )}
      </div>
    </SettingsCard>
  )
}
