/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserProfile } from '../types'
import { InfoRow, SettingsCard } from './list-card'

interface AccountInfoCardProps {
  profile: UserProfile | null
  loading: boolean
}

const STATUS_MAP: Record<number, { key: string; tone: string }> = {
  1: { key: 'Enabled', tone: 'text-emerald-600' },
  2: { key: 'Disabled', tone: 'text-red-600' },
  3: { key: 'Pending', tone: 'text-amber-600' },
}

export function AccountInfoCard({ profile, loading }: AccountInfoCardProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <SettingsCard
        title={t('Account Info')}
        description={t('Your account group, status and registration time')}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className='flex items-center justify-between gap-4 py-2.5'
          >
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-4 w-40' />
          </div>
        ))}
      </SettingsCard>
    )
  }

  if (!profile) return null

  const status = STATUS_MAP[profile.status]

  return (
    <SettingsCard
      title={t('Account Info')}
      description={t('Your account group, status and registration time')}
    >
      {/* 用户名与账号 ID 见 hero 区;邮箱见下方「账号信息」卡 */}
      <InfoRow label={t('Group')}>{profile.group || '-'}</InfoRow>
      <InfoRow label={t('Status')}>
        <span className={cn('font-medium', status?.tone)}>
          {status ? t(status.key) : '-'}
        </span>
      </InfoRow>
      <InfoRow label={t('Created At')} className='tabular-nums'>
        {formatTimestamp(profile.created_time)}
      </InfoRow>
    </SettingsCard>
  )
}
