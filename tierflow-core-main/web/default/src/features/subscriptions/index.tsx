/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import { PlanModelSets } from '@/features/plan-model-sets'
import { SubscriptionsDialogs } from './components/subscriptions-dialogs'
import { SubscriptionsPrimaryButtons } from './components/subscriptions-primary-buttons'
import {
  SubscriptionsProvider,
  useSubscriptions,
} from './components/subscriptions-provider'
import { SubscriptionsTable } from './components/subscriptions-table'

type SectionId = 'plans' | 'model-sets'

function SubscriptionsContent() {
  const { t } = useTranslation()
  const { complianceConfirmed } = useSubscriptions()
  const [section, setSection] = useState<SectionId>('plans')

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Subscription Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          {section === 'plans' ? (
            <div className='flex items-center gap-2'>
              <SubscriptionsPrimaryButtons />
            </div>
          ) : null}
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='space-y-4'>
            <Tabs
              value={section}
              onValueChange={(v) => setSection(v as SectionId)}
            >
              <TabsList>
                <TabsTrigger value='plans'>{t('Plans')}</TabsTrigger>
                <TabsTrigger value='model-sets'>
                  {t('Plan Model Sets')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {section === 'plans' ? (
              <>
                {!complianceConfirmed ? (
                  <Alert variant='destructive' className='mb-4'>
                    <AlertDescription>
                      {t(
                        'Subscription plan creation and changes are locked until the administrator confirms compliance terms in Payment Gateway settings.'
                      )}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <SubscriptionsTable />
              </>
            ) : (
              <PlanModelSets />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <SubscriptionsDialogs />
    </>
  )
}

export function Subscriptions() {
  return (
    <SubscriptionsProvider>
      <SubscriptionsContent />
    </SubscriptionsProvider>
  )
}
