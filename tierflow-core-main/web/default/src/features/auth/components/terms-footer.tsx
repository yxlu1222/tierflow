/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface TermsFooterProps {
  variant?: 'sign-in' | 'sign-up'
  className?: string
}

export function TermsFooter({
  variant = 'sign-in',
  className,
}: TermsFooterProps) {
  const { t } = useTranslation()
  const text =
    variant === 'sign-in'
      ? t('By clicking sign in, you agree to our')
      : t('By creating an account, you agree to our')

  return (
    <p className={cn('text-muted-foreground text-center text-xs', className)}>
      {text}{' '}
      <a
        href='/user-agreement'
        className='hover:text-primary underline underline-offset-4'
      >
        {t('User Agreement')}
      </a>{' '}
      {t('and')}{' '}
      <a
        href='/privacy-policy'
        className='hover:text-primary underline underline-offset-4'
      >
        {t('Privacy Policy')}
      </a>
      .
    </p>
  )
}
