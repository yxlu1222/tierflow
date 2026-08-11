/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import {
  BackToHomeButton,
  ErrorLayout,
  GoBackButton,
} from './error-layout'

export function NotFoundError() {
  const { t } = useTranslation()
  return (
    <ErrorLayout
      code='404'
      title={t('Oops! Page Not Found!')}
      description={
        <>
          {t("It seems like the page you're looking for")} <br />
          {t('does not exist or might have been removed.')}
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
