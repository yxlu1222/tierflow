/*
Copyright (C) 2023-2026 TierFlow
*/
import { type TFunction } from 'i18next'
import { Wrench } from 'lucide-react'
import type { NavGroup, SidebarView } from '../types'

function getSystemSettingsNavGroups(t: TFunction): NavGroup[] {
  return [
    {
      id: 'appliance-settings',
      title: t('Appliance Settings'),
      items: [
        {
          title: t('System maintenance'),
          url: '/system-settings/operations/update-checker',
          icon: Wrench,
        },
      ],
    },
  ]
}

export const SYSTEM_SETTINGS_VIEW: SidebarView = {
  id: 'system-settings',
  pathPattern: /^\/system-settings(\/|$)/,
  parent: {
    to: '/usage',
    label: 'Back to Appliance Home',
  },
  getNavGroups: getSystemSettingsNavGroups,
}
