/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 数据分析页(/dashboard)—— 管理端。
 *
 * 用户端的「用量信息」已独立为 /usage(见 usage-page.tsx),这里只剩平台维度的
 * 用户分析与财务两个分区,整页 adminOnly(路由层已拦截非管理员)。
 */
import { useCallback, useMemo, lazy, Suspense } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import {
  type DashboardSectionId,
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_SECTION_IDS,
} from './section-registry'

const route = getRouteApi('/_authenticated/dashboard/$section')

const LazySiteUsagePanel = lazy(() =>
  import('./components/usage/site-usage-panel').then((m) => ({
    default: m.SiteUsagePanel,
  }))
)

const LazyUserCharts = lazy(() =>
  import('./components/users/user-charts').then((m) => ({
    default: m.UserCharts,
  }))
)

function ChartFallback() {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex items-center justify-between border-b px-4 py-3 sm:px-5'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-8 w-72' />
      </div>
      <div className='h-96 p-2'>
        <Skeleton className='h-full w-full' />
      </div>
    </div>
  )
}

const SECTION_META: Record<DashboardSectionId, { titleKey: string }> = {
  usage: {
    titleKey: 'Site Usage',
  },
  users: {
    titleKey: 'User Analytics',
  },
}

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = route.useParams()
  const activeSection = (params.section ??
    DASHBOARD_DEFAULT_SECTION) as DashboardSectionId

  const sections = useMemo(() => DASHBOARD_SECTION_IDS, [])

  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/dashboard/$section',
        params: { section: section as DashboardSectionId },
      })
    },
    [navigate]
  )

  return (
    <SectionPageLayout scrollHeader>
      <SectionPageLayout.Title>
        {t('Inference Analytics')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-4 sm:space-y-5'>
          <div className='flex flex-wrap items-center justify-between gap-1.5 sm:gap-2'>
            <Tabs value={activeSection} onValueChange={handleSectionChange}>
              <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
                {sections.map((section) => (
                  <TabsTrigger key={section} value={section}>
                    {t(SECTION_META[section].titleKey)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          {activeSection === 'usage' && (
            <FadeIn>
              <Suspense fallback={<ChartFallback />}>
                <LazySiteUsagePanel />
              </Suspense>
            </FadeIn>
          )}
          {activeSection === 'users' && (
            <FadeIn>
              <Suspense fallback={<ChartFallback />}>
                <LazyUserCharts />
              </Suspense>
            </FadeIn>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
