/*
Copyright (C) 2023-2026 TierFlow
*/
import type { AxiosError } from 'axios'
import i18next from 'i18next'

export interface VerificationRequiredInfo {
  code?: string
  message: string
  required: boolean
}

/**
 * Determine whether an Axios error indicates secure verification is required.
 */
export function isVerificationRequiredError(
  error: unknown
): error is AxiosError {
  if (!error || typeof error !== 'object') return false
  const axiosError = error as AxiosError<{ code?: string }>
  const status = axiosError.response?.status
  if (status !== 403) return false

  const code = axiosError.response?.data?.code
  if (!code) return false

  const verificationCodes = new Set([
    'VERIFICATION_REQUIRED',
    'VERIFICATION_EXPIRED',
    'VERIFICATION_INVALID',
  ])

  return verificationCodes.has(code)
}

/**
 * Extract verification requirement info from an Axios error.
 */
export function extractVerificationInfo(
  error: unknown
): VerificationRequiredInfo {
  const axiosError = error as AxiosError<{ code?: string; message?: string }>
  const code = axiosError.response?.data?.code
  const message =
    axiosError.response?.data?.message ??
    i18next.t('Secure verification is required')

  return {
    code,
    message,
    required: true,
  }
}
