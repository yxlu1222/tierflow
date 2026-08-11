/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { BackToHomeButton, ErrorLayout, GoBackButton } from './error-layout'

type GeneralErrorProps = {
  minimal?: boolean
  error?: unknown
  className?: string
}

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const response = (error as Record<string, unknown>).response
  if (typeof response !== 'object' || response === null) return undefined
  const status = (response as Record<string, unknown>).status
  return typeof status === 'number' ? status : undefined
}

export function GeneralError({
  className,
  minimal = false,
  error,
}: GeneralErrorProps) {
  const { t } = useTranslation()
  const status = getHttpStatus(error)
  const isRateLimited = status === 429
  const title = isRateLimited
    ? t('Too many requests')
    : `${t('Oops! Something went wrong')} ${`:')`}`
  const description = isRateLimited
    ? t('Please wait a moment before trying again.')
    : t('Please try again later.')

  return (
    <ErrorLayout
      className={className}
      code={minimal ? undefined : (status ?? 500)}
      title={title}
      description={
        <>
          {t('We apologize for the inconvenience.')} <br /> {description}
        </>
      }
      hint={
        minimal
          ? undefined
          : t('If this keeps happening, please contact an administrator.')
      }
      actions={
        minimal ? undefined : (
          <>
            <GoBackButton />
            <BackToHomeButton />
          </>
        )
      }
    />
  )
}
