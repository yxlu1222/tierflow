/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { logout } from '@/features/auth/api'

interface SignOutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignOutDialog({ open, onOpenChange }: SignOutDialogProps) {
  const { t } = useTranslation()
  const { auth } = useAuthStore()

  const handleSignOut = async () => {
    try {
      await logout()
    } catch {
      /* empty */
    }
    auth.reset()
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('uid')
      }
    } catch {
      /* empty */
    }
    toast.success(t('Signed out'))
    // Refresh the page to clear all state and update UI
    if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Sign out')}
      desc={t(
        'Are you sure you want to sign out? You will need to sign in again to access your account.'
      )}
      confirmText={t('Sign out')}
      handleConfirm={handleSignOut}
      // 登出会清空本地状态并刷新页面,按破坏性操作处理;宽度不再单独收窄,
      // 跟其它确认弹窗保持同一尺寸
      destructive
    />
  )
}
