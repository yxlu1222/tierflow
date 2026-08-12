/*
Copyright (C) 2023-2026 TierFlow
*/
import i18next from 'i18next'
import { getCommonAuthHeaders } from '@/lib/auth-session'
import { api } from '@/lib/http-client'

export {
  applyAuthBundle,
  applyAuthRotation,
  bootstrapAuthentication,
  clearAuthenticatedClientState,
  clearAuthentication,
  isAuthBundle,
  refreshAuthentication,
  AuthRotationError,
} from '@/lib/auth-session'
export type { RefreshOutcome } from '@/lib/auth-session'
export { api }
export type { ApiRequestConfig } from '@/lib/http-client'

// ============================================================================
// Common Headers Utility
// ============================================================================

/**
 * Get user ID from localStorage
 */
/**
 * Current UI language, for the `Accept-Language` header.
 *
 * The backend resolves the response language from (in order) the user's saved
 * setting, then `Accept-Language`, then English. On unauthenticated endpoints —
 * login above all — only the header is available, so without this the browser's
 * own locale decides and a zh UI on an en-US browser gets English errors.
 * `Accept-Language` is CORS-safelisted, so overriding it from script is fine;
 * the backend normalizes `zh` to `zh-CN` itself.
 */
function getLanguageHeader(): string {
  return i18next.language || i18next.options?.fallbackLng?.toString() || 'en'
}

/**
 * Get common request headers (for both axios and SSE requests)
 */
export function getCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': getLanguageHeader(),
    ...getCommonAuthHeaders(),
  }
  return headers
}

api.interceptors.request.use((config) => {
  config.headers['Accept-Language'] = getLanguageHeader()
  return config
})

// ============================================================================
// Common API Functions
// ============================================================================

// ----------------------------------------------------------------------------
// User APIs
// ----------------------------------------------------------------------------

// Get current user info
export async function getSelf() {
  const res = await api.get('/api/user/self', {
    // Avoid global 401 toast during guards/preloads
    skipErrorHandler: true,
  })
  return res.data
}

// Get user available models
export async function getUserModels(): Promise<{
  success: boolean
  message?: string
  data?: string[]
}> {
  const res = await api.get('/api/user/models')
  return res.data
}

// Get user groups with descriptions and ratios
export async function getUserGroups(): Promise<{
  success: boolean
  message?: string
  data?: Record<string, { desc: string; ratio: number | string }>
}> {
  const res = await api.get('/api/user/self/groups')
  return res.data
}

// ----------------------------------------------------------------------------
// System APIs
// ----------------------------------------------------------------------------

// Get system status
export async function getStatus() {
  const res = await api.get('/api/status')
  return res.data?.data as Record<string, unknown>
}

// ----------------------------------------------------------------------------
// 2FA Management APIs
// ----------------------------------------------------------------------------

// Get 2FA status
export async function get2FAStatus() {
  const res = await api.get('/api/user/2fa/status')
  return res.data
}

// Setup 2FA
export async function setup2FA() {
  const res = await api.post('/api/user/2fa/setup')
  return res.data
}

// Enable 2FA with verification code
export async function enable2FA(code: string) {
  const res = await api.post('/api/user/2fa/enable', { code })
  return res.data
}

// Disable 2FA with verification code
export async function disable2FA(code: string) {
  const res = await api.post('/api/user/2fa/disable', { code })
  return res.data
}

// Regenerate 2FA backup codes
export async function regenerate2FABackupCodes(code: string) {
  const res = await api.post('/api/user/2fa/backup_codes', { code })
  return res.data
}
