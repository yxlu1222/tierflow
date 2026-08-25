/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { formatTimestamp } from '@/lib/format'
import { SettingsSection } from '../components/settings-section'

type UpdateCheckerSectionProps = {
  currentVersion?: string | null
  startTime?: number | null
}

export function UpdateCheckerSection({
  currentVersion,
  startTime,
}: UpdateCheckerSectionProps) {
  const { t } = useTranslation()
  const uptime = startTime ? formatTimestamp(startTime) : t('Unknown')
  const version = currentVersion || t('Unknown')

  return (
    <SettingsSection title={t('System maintenance')}>
      <div className='space-y-5'>
        <div className='grid gap-4 md:grid-cols-2'>
          <div className='rounded-2xl border border-slate-200 bg-slate-50/70 p-5'>
            <div className='text-base text-slate-500'>{t('Current version')}</div>
            <div className='mt-2 text-2xl font-semibold text-slate-950'>
              {version}
            </div>
          </div>
          <div className='rounded-2xl border border-slate-200 bg-slate-50/70 p-5'>
            <div className='text-base text-slate-500'>{t('Uptime since')}</div>
            <div className='mt-2 text-2xl font-semibold text-slate-950'>
              {uptime}
            </div>
          </div>
        </div>
        <p className='text-base leading-7 text-slate-500'>
          {t(
            'Appliance software is maintained through validated offline release packages.'
          )}
        </p>
      </div>
    </SettingsSection>
  )
}
