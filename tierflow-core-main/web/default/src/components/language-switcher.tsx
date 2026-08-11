/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback } from 'react'
import { normalizeInterfaceLanguage } from '@/i18n/languages'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const user = useAuthStore((s) => s.auth.user)
  const currentLanguage = normalizeInterfaceLanguage(i18n.language)
  const nextLanguage = currentLanguage === 'zh' ? 'en' : 'zh'

  const handleToggleLanguage = useCallback(async () => {
    await i18n.changeLanguage(nextLanguage)
    if (user) {
      try {
        await api.put('/api/user/self', { language: nextLanguage })
      } catch {
        // Best-effort persistence; don't block the UI on failure
      }
    }
  }, [i18n, user, nextLanguage])

  return (
    <Button
      variant='ghost'
      size='icon'
      className='h-9 w-9'
      onClick={handleToggleLanguage}
      aria-label={t('Change language')}
      title={t('Change language')}
    >
      {/* 显示"切换后"的目标语言:当前中文 → 显示 EN,当前英文 → 显示 中 */}
      <span className='text-[13px] font-semibold leading-none tracking-tight'>
        {nextLanguage === 'zh' ? '中' : 'EN'}
      </span>
    </Button>
  )
}
