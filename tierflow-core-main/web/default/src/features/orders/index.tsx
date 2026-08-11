/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import { SubscriptionOrdersTable } from './components/subscription-orders-table'
import { TopupOrdersTable } from './components/topup-orders-table'

type SectionId = 'topup' | 'subscription'

export function OrdersManagement() {
  const { t } = useTranslation()
  const [section, setSection] = useState<SectionId>('topup')

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Order Management')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <Tabs
            value={section}
            onValueChange={(v) => setSection(v as SectionId)}
          >
            <TabsList>
              {/* 资金订单 = TopUp 全量行:钱包充值 + 订阅订单的资金镜像 */}
              <TabsTrigger value='topup'>{t('Payment Orders')}</TabsTrigger>
              <TabsTrigger value='subscription'>
                {t('Subscription Orders')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {section === 'topup' ? (
            <TopupOrdersTable />
          ) : (
            <SubscriptionOrdersTable />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
