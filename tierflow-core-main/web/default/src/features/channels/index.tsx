/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { ChannelsDialogs } from './components/channels-dialogs'
import { ChannelsPrimaryButtons } from './components/channels-primary-buttons'
import { ChannelsProvider } from './components/channels-provider'
import { ChannelsTable } from './components/channels-table'

export function Channels() {
  const { t } = useTranslation()
  return (
    <ChannelsProvider>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Channels')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <ChannelsPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <ChannelsTable />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ChannelsDialogs />
    </ChannelsProvider>
  )
}
