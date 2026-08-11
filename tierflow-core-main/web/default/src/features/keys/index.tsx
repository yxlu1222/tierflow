/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysList } from './components/api-keys-list'
import { ApiKeysProvider } from './components/api-keys-provider'

export function ApiKeys() {
  const { t } = useTranslation()
  return (
    <ApiKeysProvider>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <ApiKeysList />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ApiKeysDialogs />
    </ApiKeysProvider>
  )
}
