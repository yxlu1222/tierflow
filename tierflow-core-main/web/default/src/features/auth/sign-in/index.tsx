/*
Copyright (C) 2023-2026 TierFlow
*/
import { Link, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useStatus } from '@/hooks/use-status'
import { AuthLayout } from '../auth-layout'
import { authSwitchLinkClass, authSwitchTextClass } from '../auth-styles'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { t } = useTranslation()
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })
  const { status } = useStatus()

  const registerEnabled =
    !status?.self_use_mode_enabled && status?.register_enabled !== false

  return (
    <AuthLayout>
      <div className='w-full'>
        <div className='mb-7'>
          <h1 className='mb-2 text-[28px] font-semibold tracking-[-0.015em] text-[#111827]'>
            {t('Welcome back')}
          </h1>
          <p className='m-0 text-sm text-[#6b7280]'>
            {t('Use your account to continue.')}
          </p>
        </div>

        <UserAuthForm redirectTo={redirect} />

        {registerEnabled && (
          <p className={authSwitchTextClass}>
            {t("Don't have an account?")}{' '}
            <Link to='/sign-up' className={authSwitchLinkClass}>
              {t('Sign up now')}
            </Link>
          </p>
        )}
      </div>
    </AuthLayout>
  )
}
