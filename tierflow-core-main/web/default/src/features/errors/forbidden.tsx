/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import {
  BackToHomeButton,
  ErrorLayout,
  GoBackButton,
} from './error-layout'

export function ForbiddenError() {
  const { t } = useTranslation()
  return (
    <ErrorLayout
      code='403'
      title={t('Access Forbidden')}
      description={
        <>
          {t("You don't have necessary permission")} <br />
          {t('to view this resource.')}
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
