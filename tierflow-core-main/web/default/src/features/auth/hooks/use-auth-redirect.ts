/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import i18n from 'i18next'

import { applyAuthBundle } from '@/lib/api'
import type { AuthBundle, AuthUser } from '@/stores/auth-store'

function getSavedLanguage(user: AuthUser): string | undefined {
  if (typeof user.language === 'string') return user.language

  if (user.setting && typeof user.setting === 'object') {
    return typeof user.setting.language === 'string'
      ? user.setting.language
      : undefined
  }
  if (typeof user.setting !== 'string') return undefined

  try {
    const setting = JSON.parse(user.setting) as { language?: unknown }
    return typeof setting.language === 'string' ? setting.language : undefined
  } catch {
    return undefined
  }
}

function sanitizeRedirect(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const target = value.trim()
  if (!target || !target.startsWith('/') || target.startsWith('//')) return null
  if (target.includes('\\')) return null

  try {
    const url = new URL(target, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function useAuthRedirect() {
  const navigate = useNavigate()

  const handleLoginSuccess = async (
    bundle: AuthBundle,
    redirectTo?: string
  ) => {
    applyAuthBundle(bundle)

    const savedLang = getSavedLanguage(bundle.user)
    if (savedLang && savedLang !== i18n.language) {
      await i18n.changeLanguage(savedLang)
    }

    const targetPath = sanitizeRedirect(redirectTo) ?? '/usage'
    navigate({ href: targetPath, replace: true })
  }

  const redirectTo2FA = () => {
    navigate({ to: '/otp', replace: true })
  }

  const redirectToLogin = () => {
    navigate({ to: '/sign-in', replace: true })
  }

  const redirectToRegister = () => {
    navigate({ to: '/sign-up', replace: true })
  }

  return {
    handleLoginSuccess,
    redirectTo2FA,
    redirectToLogin,
    redirectToRegister,
  }
}
