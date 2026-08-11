/*
Copyright (C) 2023-2026 TierFlow
*/
export const INTERFACE_LANGUAGE_OPTIONS = [
  { code: 'zh', label: '简体中文' },
  { code: 'en', label: 'English' },
] as const

export type InterfaceLanguageCode =
  (typeof INTERFACE_LANGUAGE_OPTIONS)[number]['code']

export function normalizeInterfaceLanguage(value?: string | null): string {
  if (!value) return 'en'

  const normalized = value.trim().replace(/_/g, '-').toLowerCase()
  if (normalized.startsWith('zh')) return 'zh'

  return INTERFACE_LANGUAGE_OPTIONS.some((lang) => lang.code === normalized)
    ? normalized
    : 'en'
}
