/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Application-wide constants
 */

// System Configuration Defaults
export const DEFAULT_SYSTEM_NAME = 'TierFlow'
// Logo is hardcoded to the bundled brand asset (public/tierflow-logo.svg);
// it is no longer operator-configurable and not delivered by the backend.
export const DEFAULT_LOGO = '/tierflow-logo.svg'

// 官方文档站 —— 后端未配置 docs_link 时的兜底(站内没有 /docs 路由,
// 回落到内部路径会直接 404)。页脚与落地页的文档入口也共用这一个常量。
export const DOCS_URL = 'https://neofii.github.io/TierFlow-Doc/'

// LocalStorage Keys
export const STORAGE_KEYS = {
  SYSTEM_NAME: 'system_name',
  FOOTER_HTML: 'footer_html',
} as const
