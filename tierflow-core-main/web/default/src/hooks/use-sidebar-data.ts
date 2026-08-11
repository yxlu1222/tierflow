/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  Activity,
  BarChart3,
  Box,
  Boxes,
  CreditCard,
  Crown,
  Key,
  LifeBuoy,
  Megaphone,
  MessagesSquare,
  Radio,
  Receipt,
  ReceiptText,
  Route,
  Settings,
  Ticket,
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
      // 普通用户区扁平化:不分一级类目,所有入口平铺成一列,靠图标和顺序区分。
      // 用户端总共就七个入口,分组反而制造了「每组一两项」的碎片感。顺序按
      // 「看用量 → 接入 → 两条计费通道 → 账户」排,订阅制和按量付费相邻但不
      // 混淆(两者互不串扣,套餐桶用尽不会回落到余额)。
      // 管理员功能仍按域分三组 —— 那边入口多,分组是有效的。
      {
        id: 'user',
        title: '',
        items: [
          {
            title: t('Usage Info'),
            url: '/usage',
            icon: BarChart3,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('My Subscription'),
            url: '/subscription',
            icon: Crown,
          },
          {
            title: t('Recharge'),
            url: '/recharge',
            icon: CreditCard,
          },
          {
            title: t('Bills'),
            url: '/billing',
            icon: Receipt,
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
          {
            title: t('Subscription Management'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('Order Management'),
            url: '/orders',
            icon: ReceiptText,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
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
