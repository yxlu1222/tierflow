/*
Copyright (C) 2023-2026 TierFlow
*/
import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'

/**
 * 管理端数据分析的分区定义。
 *
 * 原来的 'overview' 分区已独立为用户端的 /usage(见 features/dashboard/usage-page)
 * —— 用户看自己的用量、管理员看平台分析,受众和数据源都不同。这里只剩管理端分区,
 * 因此整页都是 adminOnly。
 */
const DASHBOARD_SECTIONS = [
  {
    id: 'usage',
    titleKey: 'Site Usage',
    adminOnly: true,
    build: () => null,
  },
  {
    id: 'users',
    titleKey: 'User Analytics',
    adminOnly: true,
    build: () => null,
  },
] as const

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]['id']

const dashboardRegistry = createSectionRegistry<
  DashboardSectionId,
  Record<string, never>,
  []
>({
  sections: DASHBOARD_SECTIONS,
  defaultSection: 'usage',
  basePath: '/dashboard',
  urlStyle: 'path',
})

export const DASHBOARD_SECTION_IDS = dashboardRegistry.sectionIds
export const DASHBOARD_DEFAULT_SECTION = dashboardRegistry.defaultSection
