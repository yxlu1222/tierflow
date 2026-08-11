/*
Copyright (C) 2023-2026 TierFlow
*/
import { type LinkProps } from '@tanstack/react-router'
import { type TFunction } from 'i18next'

/**
 * Base navigation item type
 */
type BaseNavItem = {
  title: string
  badge?: string
  icon?: React.ElementType
  activeUrls?: (LinkProps['to'] | (string & {}))[]
  configUrls?: (LinkProps['to'] | (string & {}))[]
}

/**
 * Navigation link type - single link item
 */
export type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
  type?: never
}

/**
 * Navigation collapsible type - collapsible navigation with sub-items
 */
export type NavCollapsible = BaseNavItem & {
  items: (BaseNavItem & { url: LinkProps['to'] | (string & {}) })[]
  url?: never
  type?: never
}

/**
 * Navigation item union type
 */
export type NavItem = NavCollapsible | NavLink

/**
 * Navigation group type - a group of navigation items in sidebar
 */
export type NavGroup = {
  id?: string
  title: string
  /** Optional leading icon shown before the group title. */
  icon?: React.ElementType
  /** When true, the group is only rendered for users with role >= ADMIN. */
  adminOnly?: boolean
  items: NavItem[]
}

/**
 * Root sidebar data type
 *
 * Used by the default (top-level) sidebar view that lists primary
 * application navigation (chat, dashboard, admin, etc).
 */
export type SidebarData = {
  navGroups: NavGroup[]
}

/**
 * Top navigation link type
 */
export type TopNavLink = {
  title: string
  href: string
  isActive?: boolean
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

/**
 * Back-navigation descriptor for a nested sidebar view
 */
export type SidebarViewParent = {
  /** Destination URL for the back button */
  to: LinkProps['to'] | (string & {})
  /** Visible label, e.g. "Back to Dashboard" — already localized */
  label: string
}

/**
 * Nested sidebar view configuration
 *
 * A nested view replaces the root navigation when the user enters a
 * dedicated workspace (e.g. System Settings). It models the modern
 * Vercel / Cloudflare "drill-in" sidebar UX: clicking a top-level entry
 * swaps the sidebar to a contextual view with a "Back" affordance.
 */
export type SidebarView = {
  /** Stable identifier (also drives transition animation keys) */
  id: string
  /** Path matcher that activates this view */
  pathPattern: RegExp
  /** Back-navigation descriptor; required for nested views */
  parent: SidebarViewParent
  /** Nav group builder, called per render with the active translator */
  getNavGroups: (t: TFunction) => NavGroup[]
}

/**
 * Resolved sidebar view returned by `useSidebarView()`
 *
 * - `view === null`: root navigation (default sidebar)
 * - `view !== null`: nested workspace view (renders header + back button)
 */
export type ResolvedSidebarView = {
  /** Animation/identity key — falls back to a sentinel for the root view */
  key: string
  view: SidebarView | null
  navGroups: NavGroup[]
}
