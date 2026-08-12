/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  Activity,
  BarChart3,
  Box,
  Boxes,
  CircleGauge,
  Key,
  LifeBuoy,
  Megaphone,
  MessagesSquare,
  Radio,
  Route,
  Settings,
  User,
  Users,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { type SidebarData } from '@/components/layout/types'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()
  const userRole = useAuthStore((s) => s.auth.user?.role)
  const isSuperAdmin = userRole === ROLE.SUPER_ADMIN

  return {
    navGroups: [
      // 一体机用户区保持扁平：首屏、API Key、通知、工单与账户。
      // 管理员功能仍按域分组，便于在设备上执行模型与系统运维。
      {
        id: 'user',
        title: '',
        items: [
          {
            title: t('Appliance Home'),
            url: '/usage',
            icon: CircleGauge,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('System Notifications'),
            url: '/notifications/system',
            icon: Megaphone,
          },
          {
            title: t('Ticket Records'),
            url: '/notifications/tickets',
            icon: MessagesSquare,
          },
          {
            title: t('Profile'),
            url: '/profile',
            icon: User,
          },
        ],
      },
      // 管理员区:原 admin 单组按功能域拆为三组,统一由 adminOnly 门控
      // (role >= ADMIN)。见 use-sidebar-view.ts 的角色过滤。
      {
        id: 'models-routing',
        title: t('Models & Routing'),
        icon: Boxes,
        adminOnly: true,
        items: [
          {
            title: t('Channel Management'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Routing Profiles'),
            url: '/routing-profiles',
            icon: Route,
          },
          {
            title: t('Route Monitor'),
            url: '/route-monitor',
            icon: Activity,
          },
          {
            title: t('Model Management'),
            url: '/models/metadata',
            icon: Box,
          },
        ],
      },
      {
        id: 'users-billing',
        title: t('Users & Billing'),
        icon: Users,
        adminOnly: true,
        items: [
          {
            // 平台维度的用户分析 / 财务;用户看自己的用量在 /usage
            title: t('Analytics'),
            url: '/dashboard/usage',
            activeUrls: ['/dashboard'],
            icon: BarChart3,
          },
          {
            title: t('User Management'),
            url: '/users',
            icon: Users,
          },
        ],
      },
      {
        id: 'ops-system',
        title: t('Operations & System'),
        icon: Wrench,
        adminOnly: true,
        items: [
          {
            title: t('Ticket Management'),
            url: '/tickets',
            activeUrls: ['/tickets'],
            icon: LifeBuoy,
          },
          ...(isSuperAdmin
            ? [
                {
                  title: t('Announcement Management'),
                  url: '/announcements',
                  icon: Megaphone,
                },
              ]
            : []),
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
          },
        ],
      },
    ],
  }
}
