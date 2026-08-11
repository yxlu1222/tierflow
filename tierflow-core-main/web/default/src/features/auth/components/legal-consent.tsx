/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface LegalConsentProps {
  checked: boolean
  onCheckedChange: (nextValue: boolean) => void
  className?: string
}

export function LegalConsent({
  checked,
  onCheckedChange,
  className,
}: LegalConsentProps) {
  const { t } = useTranslation()

  const handleChange = (value: boolean) => {
    onCheckedChange(value === true)
  }

  return (
    <div className={cn('flex items-start gap-2', className)}>
      <Checkbox
        id='legal-consent'
        checked={checked}
        onCheckedChange={handleChange}
        className='mt-0.5'
      />
      <Label
        htmlFor='legal-consent'
        className='text-muted-foreground items-start gap-1 text-left text-xs leading-5 font-normal'
      >
        <span>
          {t('I have read and agree to the')}{' '}
          <a
            href='/user-agreement'
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary hover:underline'
          >
            {t('User Agreement')}
          </a>{' '}
          {t('and')}{' '}
          <a
            href='/privacy-policy'
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary hover:underline'
          >
            {t('Privacy Policy')}
          </a>
          .
        </span>
      </Label>
    </div>
  )
}
