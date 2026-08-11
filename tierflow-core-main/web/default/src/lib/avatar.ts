/*
Copyright (C) 2023-2026 TierFlow
*/
import type { CSSProperties } from 'react'

export type UserAvatarStyle = Pick<CSSProperties, 'backgroundColor' | 'color'>

/**
 * Unified user-avatar look across the app: a white background with a blue
 * initial. Kept as a helper (rather than plain classes) so every avatar —
 * header, profile dropdown, and the profile page — stays in sync.
 */
export function getUserAvatarStyle(_name?: string): UserAvatarStyle {
  return {
    backgroundColor: '#ffffff',
    color: '#2563eb',
  }
}

export function getUserAvatarFallback(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}
