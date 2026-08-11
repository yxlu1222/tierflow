/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import {
  BackToHomeButton,
  ErrorLayout,
  GoBackButton,
} from './error-layout'

export function UnauthorisedError() {
  const { t } = useTranslation()
  return (
    <ErrorLayout
      code='401'
      title={t('Unauthorized Access')}
      description={
        <>
          {t('Please log in with the appropriate credentials')} <br />
          {t('to access this resource.')}
        </>
      }
      actions={
        <>
          <GoBackButton />
          <BackToHomeButton />
        </>
      }
    />
  )
}
