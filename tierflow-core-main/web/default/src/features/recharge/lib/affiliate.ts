/*
Copyright (C) 2023-2026 TierFlow
*/
// ============================================================================
// Affiliate Functions
// ============================================================================

/**
 * Generate affiliate registration link
 */
export function generateAffiliateLink(affCode: string): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}/sign-up?aff=${affCode}`
}
