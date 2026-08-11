/*
Copyright (C) 2023-2026 TierFlow
*/
import { SystemInfoSection } from '../general/system-info-section'
import type { SiteSettings } from '../types'
import { createSectionRegistry } from '../utils/section-registry'

const SITE_SECTIONS = [
  {
    id: 'system-info',
    titleKey: 'System Information',
    build: (settings: SiteSettings) => (
      <SystemInfoSection
        defaultValues={{
          ServerAddress: settings.ServerAddress,
        }}
      />
    ),
  },
] as const

export type SiteSectionId = (typeof SITE_SECTIONS)[number]['id']

const siteRegistry = createSectionRegistry<SiteSectionId, SiteSettings>({
  sections: SITE_SECTIONS,
  defaultSection: 'system-info',
  basePath: '/system-settings/site',
  urlStyle: 'path',
})

export const SITE_SECTION_IDS = siteRegistry.sectionIds
export const SITE_DEFAULT_SECTION = siteRegistry.defaultSection
export const getSiteSectionNavItems = siteRegistry.getSectionNavItems
export const getSiteSectionContent = siteRegistry.getSectionContent
export const getSiteSectionMeta = siteRegistry.getSectionMeta
