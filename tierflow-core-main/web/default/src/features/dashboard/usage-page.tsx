/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 用量信息页(/usage)—— 用户端入口。
 *
 * 与 /dashboard 的关系:这里是**用户看自己的用量**,没有分区 tab;/dashboard 是
 * 管理端看平台的用户分析 / 财务。两者读的数据源和受众都不同,所以拆成两个路由,
 * 而不是同一个页面靠 adminOnly 分区切换 —— 那样管理员的「财务」会挂在用量页下。
 */
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { OverviewDashboard } from './components/overview/overview-dashboard'

export function UsagePage() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout scrollHeader>
      <SectionPageLayout.Title>{t('Usage Info')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <OverviewDashboard />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
