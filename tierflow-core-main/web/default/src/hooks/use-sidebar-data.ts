/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  BarChart3,
  Boxes,
  CircleGauge,
  Key,
  LayoutGrid,
  ServerCog,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type SidebarData } from '@/components/layout/types'

/**
 * Appliance navigation deliberately exposes only the tasks needed to operate
 * a dedicated local inference device. Provider channels and routing profiles
 * remain backend implementation details and are not user-selectable here.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()

  return {
    navGroups: [
      {
        id: 'appliance',
        title: '',
        items: [
          {
            title: t('Appliance Home'),
            url: '/usage',
            icon: CircleGauge,
          },
          {
            title: t('Model Services'),
            url: '/model-services',
            icon: Boxes,
            adminOnly: true,
          },
          {
            title: t('Skill Center'),
            url: '/skills',
            icon: LayoutGrid,
          },
          {
            title: t('API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Inference Analytics'),
            url: '/dashboard/usage',
            activeUrls: ['/dashboard'],
            icon: BarChart3,
            adminOnly: true,
          },
          {
            title: t('User Management'),
            url: '/users',
            icon: UsersRound,
            adminOnly: true,
          },
          {
            title: t('Device Management'),
            url: '/device-status',
            icon: ServerCog,
            adminOnly: true,
          },
        ],
      },
    ],
  }
}
