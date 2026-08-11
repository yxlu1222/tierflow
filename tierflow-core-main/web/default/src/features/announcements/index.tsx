/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { AnnouncementsPrimaryButtons } from './components/announcements-primary-buttons'
import { AnnouncementsTable } from './components/announcements-table'

/**
 * Standalone "Notice Center" workspace (super-admin only).
 *
 * The platform has a single announcement model: a structured list with
 * draft/published status, scheduled publishing, category tags and pinning.
 * The panel is always enabled (visibility is driven by status/publish time
 * server-side). Create/edit happen on dedicated routes (`/announcements/new`,
 * `/announcements/$id/edit`) so the content editor gets full-width space with a
 * live side-by-side preview; rows support publish/withdraw, pin and delete.
 */
export function Announcements() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Announcement Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <AnnouncementsPrimaryButtons />
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <AnnouncementsTable />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
