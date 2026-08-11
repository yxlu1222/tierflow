/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Utilities for managing authentication-related browser storage
 */

// ============================================================================
// LocalStorage Keys
// ============================================================================

const STORAGE_KEYS = {
  // 存放对外用户标识 uid(12 位纯数字),随每个请求以 TF-User 头回显。
  // 注意:此键名早于 uid 特性存在,此前存的是数据库自增 id。
  USER_ID: 'uid',
  AFFILIATE: 'aff',
  STATUS: 'status',
} as const

// ============================================================================
// User ID Storage
// ============================================================================

/**
 * Save the public user id (uid) to localStorage.
 *
 * 参数类型收紧为 string:uid 是 12 位纯数字字符串而非整数,收紧后
 * 任何仍在传内部 id 的调用点都会在编译期报错。
 */
export function saveUserId(uid: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEYS.USER_ID, uid)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save user ID:', error)
  }
}

/**
 * Get user ID from localStorage
 */
export function getUserId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEYS.USER_ID)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get user ID:', error)
    return null
  }
}

/**
 * Remove user ID from localStorage
 */
export function removeUserId(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEYS.USER_ID)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to remove user ID:', error)
  }
}

// ============================================================================
// Affiliate Code Storage
// ============================================================================

/**
 * Get affiliate code from localStorage
 */
export function getAffiliateCode(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(STORAGE_KEYS.AFFILIATE) ?? ''
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to get affiliate code:', error)
    return ''
  }
}

/**
 * Save affiliate code to localStorage
 */
export function saveAffiliateCode(code: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEYS.AFFILIATE, code)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to save affiliate code:', error)
  }
}
