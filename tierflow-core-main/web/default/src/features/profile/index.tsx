/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { useStatus } from '@/hooks/use-status'
import { SectionPageLayout } from '@/components/layout'
import { AccountBindingsCard } from './components/account-bindings-card'
import { AccountInfoCard } from './components/account-info-card'
import { CheckinCalendarCard } from './components/checkin-calendar-card'
import { NotificationSettingsCard } from './components/notification-settings-card'
import { ProfileHero } from './components/profile-hero'
import { ProfileSecurityCard } from './components/profile-security-card'
import { useProfile } from './hooks'

export function Profile() {
  const { t } = useTranslation()
  const { profile, loading, refreshProfile } = useProfile()
  const { status } = useStatus()

  const checkinEnabled = status?.checkin_enabled === true
  const turnstileEnabled = !!(
    status?.turnstile_check && status?.turnstile_site_key
  )
  const turnstileSiteKey = status?.turnstile_site_key || ''

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Profile')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <ProfileHero profile={profile} loading={loading} />

          {checkinEnabled && (
            <CheckinCalendarCard
              checkinEnabled={checkinEnabled}
              turnstileEnabled={turnstileEnabled}
              turnstileSiteKey={turnstileSiteKey}
            />
          )}

          {/* 单列堆叠:每个设置区块一张独立卡片,卡片间靠间距分隔。 */}
          <AccountInfoCard profile={profile} loading={loading} />
          <AccountBindingsCard
            profile={profile}
            loading={loading}
            onUpdate={refreshProfile}
          />
          <NotificationSettingsCard
            profile={profile}
            onUpdate={refreshProfile}
          />
          <ProfileSecurityCard profile={profile} loading={loading} />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
