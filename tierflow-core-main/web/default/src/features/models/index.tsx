/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import { ModelGroups } from '@/features/model-groups'
import { ModelsDialogs } from './components/models-dialogs'
import { ModelsPrimaryButtons } from './components/models-primary-buttons'
import { ModelsProvider } from './components/models-provider'
import { ModelsTable } from './components/models-table'
import { VendorsTable } from './components/vendors-table'
import {
  type ModelsSectionId,
  MODELS_DEFAULT_SECTION,
  MODELS_SECTION_IDS,
} from './section-registry'

const route = getRouteApi('/_authenticated/models/$section')

const SECTION_META: Record<ModelsSectionId, { titleKey: string }> = {
  metadata: {
    titleKey: 'Models',
  },
  groups: {
    titleKey: 'Model Groups',
  },
  vendors: {
    titleKey: 'Vendors',
  },
}

function ModelsContent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = route.useParams()
  const activeSection = (params.section ??
    MODELS_DEFAULT_SECTION) as ModelsSectionId

  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/models/$section',
        params: { section: section as ModelsSectionId },
      })
    },
    [navigate]
  )

  const meta = SECTION_META[activeSection] ?? SECTION_META.metadata

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t(meta.titleKey)}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {activeSection === 'metadata' ? <ModelsPrimaryButtons /> : null}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='space-y-4'>
            <Tabs value={activeSection} onValueChange={handleSectionChange}>
              <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                {MODELS_SECTION_IDS.map((section) => (
                  <TabsTrigger key={section} value={section}>
                    {t(SECTION_META[section].titleKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {activeSection === 'metadata' ? (
              <ModelsTable />
            ) : activeSection === 'groups' ? (
              <ModelGroups />
            ) : (
              <VendorsTable />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ModelsDialogs />
    </>
  )
}

export function Models() {
  return (
    <ModelsProvider>
      <ModelsContent />
    </ModelsProvider>
  )
}
