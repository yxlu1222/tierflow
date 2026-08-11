/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { ErrorLayout } from './error-layout'

export function MaintenanceError() {
  const { t } = useTranslation()
  return (
    <ErrorLayout
      code='503'
      title={t('Website is under maintenance!')}
      description={
        <>
          {t('The site is not available at the moment.')} <br />
          {t("We'll be back online shortly.")}
        </>
      }
    />
  )
}
