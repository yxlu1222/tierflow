/*
Copyright (C) 2023-2026 TierFlow
*/
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { AuthLayout } from '../auth-layout'
import { authSwitchLinkClass, authSwitchTextClass } from '../auth-styles'
import { TermsFooter } from '../components/terms-footer'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()

  return (
    <AuthLayout>
      <div className='w-full'>
        <div className='mb-7'>
          <h1 className='mb-2 text-[28px] font-semibold tracking-[-0.015em] text-[#111827]'>
            {t('Create an account')}
          </h1>
          <p className='m-0 text-sm text-[#6b7280]'>
            {t('Register your {{name}} account via email.', {
              name: systemName,
            })}
          </p>
        </div>

        <SignUpForm />

        <p className={authSwitchTextClass}>
          {t('Already have an account?')}{' '}
          <Link to='/sign-in' className={authSwitchLinkClass}>
            {t('Sign in now')}
          </Link>
        </p>

        <TermsFooter variant='sign-up' className='mt-4 text-center' />
      </div>
    </AuthLayout>
  )
}
