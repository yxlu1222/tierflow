/*
Copyright (C) 2023-2026 TierFlow
*/
import type { QueryClient } from '@tanstack/react-query'
import axios from 'axios'

import {
  useAuthStore,
  type AuthBootstrapState,
  type AuthBundle,
  type AuthUser,
  type LoginSession,
} from '@/stores/auth-store'

export type RefreshOutcome =
  | { kind: 'authenticated'; bundle: AuthBundle }
  | { kind: 'anonymous' }
  | { kind: 'transient_error'; error: unknown }
  | { kind: 'out_of_sync'; code?: string }

export interface AuthTokenRotation {
  access_token: string
  token_type: string
  access_expires_at: number
  session: LoginSession
}

export class AuthRotationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthRotationError'
  }
}

const authClient = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: { 'Cache-Control': 'no-store' },
})

let refreshPromise: Promise<RefreshOutcome> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!isRecord(value)) return false
  return (
    Number.isInteger(value.id) &&
    Number(value.id) > 0 &&
    typeof value.username === 'string' &&
    typeof value.role === 'number'
  )
}

function isLoginSession(value: unknown): value is LoginSession {
  if (!isRecord(value)) return false
  return (
    typeof value.sid === 'string' &&
    value.sid.length > 0 &&
    typeof value.current === 'boolean' &&
    typeof value.login_method === 'string' &&
    typeof value.ip === 'string' &&
    typeof value.user_agent === 'string' &&
    typeof value.created_at === 'number' &&
    typeof value.last_active_at === 'number' &&
    typeof value.expires_at === 'number'
  )
}

function hasValidTokenFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.token_type === 'string' &&
    value.token_type.length > 0 &&
    typeof value.access_expires_at === 'number' &&
    Number.isFinite(value.access_expires_at) &&
    value.access_expires_at > 0
  )
}

export function isAuthBundle(value: unknown): value is AuthBundle {
  if (!isRecord(value)) return false
  return (
    hasValidTokenFields(value) &&
    isAuthUser(value.user) &&
    isLoginSession(value.session)
  )
}

function isAuthTokenRotation(value: unknown): value is AuthTokenRotation {
  return (
    isRecord(value) &&
    hasValidTokenFields(value) &&
    value.token_type === 'Bearer' &&
    isLoginSession(value.session) &&
    value.session.current
  )
}

export function applyAuthBundle(bundle: AuthBundle): void {
  useAuthStore.getState().auth.setBundle(bundle)
}

export function applyAuthRotation(value: unknown): void {
  if (!isAuthTokenRotation(value)) {
    throw new AuthRotationError('Invalid authentication rotation response')
  }

  const auth = useAuthStore.getState().auth
  if (!auth.user || !auth.session) {
    throw new AuthRotationError('Authentication rotation has no active session')
  }
  if (value.session.sid !== auth.session.sid) {
    throw new AuthRotationError('Authentication rotation session mismatch')
  }

  applyAuthBundle({
    access_token: value.access_token,
    token_type: value.token_type,
    access_expires_at: value.access_expires_at,
    session: value.session,
    user: auth.user,
  })
}

export function clearAuthentication(
  bootstrapState: AuthBootstrapState = 'complete'
): void {
  useAuthStore.getState().auth.reset(bootstrapState)
}

export function clearAuthenticatedClientState(queryClient: QueryClient): void {
  queryClient.clear()
  clearAuthentication()
}

async function requestRefresh(expectedSID?: string): Promise<RefreshOutcome> {
  try {
    const response = await authClient.post(
      '/api/user/auth/refresh',
      undefined,
      {
        headers: expectedSID ? { 'X-Auth-Session': expectedSID } : undefined,
      }
    )
    const bundle = response.data?.success
      ? response.data?.data
      : undefined
    if (isAuthBundle(bundle)) {
      applyAuthBundle(bundle)
      return { kind: 'authenticated', bundle }
    }
    clearAuthentication()
    return { kind: 'out_of_sync', code: 'AUTH_INVALID_REFRESH_RESPONSE' }
  } catch (error: unknown) {
    if (!axios.isAxiosError(error)) {
      useAuthStore.getState().auth.setBootstrapState('idle')
      return { kind: 'transient_error', error }
    }

    const status = error.response?.status ?? 0
    const code = error.response?.data?.code
    if (status === 401) {
      clearAuthentication()
      return { kind: 'anonymous' }
    }
    if (status === 409) {
      clearAuthentication()
      return {
        kind: 'out_of_sync',
        code: typeof code === 'string' ? code : undefined,
      }
    }
    if (!status || status >= 500 || status === 429) {
      useAuthStore.getState().auth.setBootstrapState('idle')
      return { kind: 'transient_error', error }
    }
    clearAuthentication()
    return {
      kind: 'out_of_sync',
      code: typeof code === 'string' ? code : undefined,
    }
  }
}

export function refreshAuthentication(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    const expectedSID = useAuthStore.getState().auth.session?.sid
    refreshPromise = requestRefresh(expectedSID).finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function currentValidAuthBundle(): AuthBundle | null {
  const auth = useAuthStore.getState().auth
  if (
    !auth.user ||
    !auth.accessToken ||
    !auth.accessExpiresAt ||
    !auth.session ||
    auth.accessExpiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null
  }
  return {
    access_token: auth.accessToken,
    token_type: 'Bearer',
    access_expires_at: auth.accessExpiresAt,
    user: auth.user,
    session: auth.session,
  }
}

export async function bootstrapAuthentication(): Promise<RefreshOutcome> {
  const bundle = currentValidAuthBundle()
  if (bundle) {
    useAuthStore.getState().auth.setBootstrapState('complete')
    return { kind: 'authenticated', bundle }
  }

  const auth = useAuthStore.getState().auth
  if (auth.bootstrapState === 'complete' && !auth.session) {
    return { kind: 'anonymous' }
  }

  auth.setBootstrapState('checking')
  return refreshAuthentication()
}

export function getCommonAuthHeaders(): Record<string, string> {
  const accessToken = useAuthStore.getState().auth.accessToken
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
}
