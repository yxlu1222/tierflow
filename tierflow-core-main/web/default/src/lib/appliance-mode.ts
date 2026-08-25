/*
Copyright (C) 2023-2026 TierFlow
*/

/**
 * TierFlow is delivered as a dedicated inference appliance in this build.
 * Commercial SaaS pages stay in the upstream codebase for compatibility, but
 * they are not part of the appliance product surface and must not be reachable.
 */
export const APPLIANCE_MODE = true

/**
 * Appliance users are provisioned by an administrator. Public self-service
 * registration is intentionally unavailable on a dedicated device.
 */
export const APPLIANCE_SELF_REGISTRATION_ENABLED = false

const DISABLED_COMMERCIAL_PATHS = [
  '/about',
  '/billing',
  '/console/topup',
  '/orders',
  '/pricing',
  '/recharge',
  '/redemption-codes',
  '/subscription',
  '/subscriptions',
  '/wallet',
] as const

/**
 * Legacy multi-tenant platform workspaces are intentionally not part of the
 * appliance UI. Their backend data structures remain available internally so
 * TierFlow can still route requests to local runtimes, but operators cannot
 * open or select those implementation details from the dedicated console.
 */
const DISABLED_LEGACY_PLATFORM_PATHS = [
  '/announcements',
  '/channels',
  '/notifications',
  '/profile',
  '/route-monitor',
  '/routing-profiles',
  '/tickets',
] as const

const DISABLED_APPLIANCE_WORKSPACES = ['/models', '/system-settings'] as const

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isCommercialPathDisabled(pathname: string): boolean {
  return (
    APPLIANCE_MODE &&
    DISABLED_COMMERCIAL_PATHS.some((prefix) =>
      matchesPathPrefix(pathname, prefix)
    )
  )
}

export function isAppliancePathDisabled(pathname: string): boolean {
  return (
    isCommercialPathDisabled(pathname) ||
    (APPLIANCE_MODE &&
      [...DISABLED_LEGACY_PLATFORM_PATHS, ...DISABLED_APPLIANCE_WORKSPACES].some(
        (prefix) => matchesPathPrefix(pathname, prefix)
      ))
  )
}

export function isBillingSettingsPath(pathname: string): boolean {
  return (
    APPLIANCE_MODE && matchesPathPrefix(pathname, '/system-settings/billing')
  )
}
