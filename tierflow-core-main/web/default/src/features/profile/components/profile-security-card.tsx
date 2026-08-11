/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { useDialogs } from '@/hooks/use-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { UserProfile } from '../types'
import { ChangePasswordDialog } from './dialogs/change-password-dialog'
import { DeleteAccountDialog } from './dialogs/delete-account-dialog'
import { SettingsCard } from './list-card'

// ============================================================================
// Profile Security — 密码与账户注销,各自独立成卡
// ============================================================================

interface ProfileSecurityCardProps {
  profile: UserProfile | null
  loading: boolean
}

type DialogKey = 'password' | 'delete'

export function ProfileSecurityCard({
  profile,
  loading,
}: ProfileSecurityCardProps) {
  const { t } = useTranslation()
  const dialogs = useDialogs<DialogKey>()

  if (loading) {
    return (
      <SettingsCard
        title={t('Password')}
        description={t('Update your password to keep your account secure')}
        action={<Skeleton className='h-9 w-24' />}
      />
    )
  }

  if (!profile) return null

  return (
    <>
      <SettingsCard
        title={t('Password')}
        description={t('Update your password to keep your account secure')}
        action={
          <Button
            variant='outline'
            size='lg'
            onClick={() => dialogs.open('password')}
          >
            {t('Change Password')}
          </Button>
        }
      />

      <SettingsCard
        title={t('Delete Account')}
        description={t('Permanently delete your account and all data')}
        action={
          <Button
            variant='destructive'
            size='lg'
            onClick={() => dialogs.open('delete')}
          >
            {t('Delete Account')}
          </Button>
        }
      />

      <ChangePasswordDialog
        open={dialogs.isOpen('password')}
        onOpenChange={(open) =>
          open ? dialogs.open('password') : dialogs.close('password')
        }
        username={profile.username}
      />

      <DeleteAccountDialog
        open={dialogs.isOpen('delete')}
        onOpenChange={(open) =>
          open ? dialogs.open('delete') : dialogs.close('delete')
        }
        username={profile.username}
      />
    </>
  )
}
