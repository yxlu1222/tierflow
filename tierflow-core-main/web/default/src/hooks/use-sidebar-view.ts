/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { useLocation } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { resolveSidebarView } from '@/components/layout/lib/sidebar-view-registry'
import type { NavGroup, ResolvedSidebarView } from '@/components/layout/types'
import { useSidebarData } from './use-sidebar-data'

/** Sentinel key used for the root navigation in animation `key=` props */
const ROOT_VIEW_KEY = '__root'

/**
 * Resolve the active sidebar view for the current location.
 *
 * - Returns the matching nested {@link SidebarView} (with its nav
 *   groups) when the URL belongs to a registered drill-in workspace.
 * - Otherwise returns the root navigation, narrowed only by admin-only group
 *   visibility (role-based). The former per-module visibility overlay
 *   (HeaderNavModules / SidebarModulesAdmin / per-user sidebar_modules) has been
 *   removed — every module the user's role permits is now always shown.
 */
export function useSidebarView(): ResolvedSidebarView {
  const { t } = useTranslation()
  const pathname = useLocation({ select: (l) => l.pathname })
  const userRole = useAuthStore((s) => s.auth.user?.role)
  const rootSidebarData = useSidebarData()

  const rootNavGroups = useMemo<NavGroup[]>(() => {
    const isAdmin = userRole !== undefined && userRole >= ROLE.ADMIN
    return rootSidebarData.navGroups
      .filter((group) => (group.adminOnly ? isAdmin : true))
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          item.adminOnly ? isAdmin : true
        ),
      }))
  }, [rootSidebarData.navGroups, userRole])

  const view = resolveSidebarView(pathname)

  if (view) {
    return {
      key: view.id,
      view,
      navGroups: view.getNavGroups(t),
    }
  }

  return {
    key: ROOT_VIEW_KEY,
    view: null,
    navGroups: rootNavGroups,
  }
}
