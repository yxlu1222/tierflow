/*
Copyright (C) 2023-2026 TierFlow
*/
import { type TFunction } from 'i18next'
import { type StatusBadgeProps } from '@/components/status-badge'

// ============================================================================
// 工单状态 / 优先级 / 分类 —— 与后端 model/ticket.go 的字符串常量保持一致
// ============================================================================

// 工单为一问一答、无多轮对话，只有两态：待处理 / 已解决。
export const TICKET_STATUS = {
  OPEN: 'open',
  RESOLVED: 'resolved',
} as const
export type TicketStatus = (typeof TICKET_STATUS)[keyof typeof TICKET_STATUS]
export const TICKET_STATUS_VALUES = Object.values(TICKET_STATUS) as [
  TicketStatus,
  ...TicketStatus[],
]

// 状态全序（用于筛选下拉 / faceted filter / 状态 select）
export const TICKET_BOARD_ORDER: TicketStatus[] = [
  TICKET_STATUS.OPEN,
  TICKET_STATUS.RESOLVED,
]

// 看板列：待处理 / 已解决两列。
export const TICKET_BOARD_COLUMNS: TicketStatus[] = [
  TICKET_STATUS.OPEN,
  TICKET_STATUS.RESOLVED,
]

type StatusMeta = Pick<StatusBadgeProps, 'variant'> & { labelKey: string }

export const TICKET_STATUSES: Record<TicketStatus, StatusMeta> = {
  [TICKET_STATUS.OPEN]: { labelKey: 'Awaiting Handling', variant: 'info' },
  [TICKET_STATUS.RESOLVED]: { labelKey: 'Completed', variant: 'success' },
}

export const TICKET_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  URGENT: 'urgent',
} as const
export type TicketPriority =
  (typeof TICKET_PRIORITY)[keyof typeof TICKET_PRIORITY]
export const TICKET_PRIORITY_VALUES = Object.values(TICKET_PRIORITY) as [
  TicketPriority,
  ...TicketPriority[],
]

export const TICKET_PRIORITIES: Record<TicketPriority, StatusMeta> = {
  [TICKET_PRIORITY.LOW]: { labelKey: 'Low', variant: 'neutral' },
  [TICKET_PRIORITY.MEDIUM]: { labelKey: 'Medium', variant: 'info' },
  [TICKET_PRIORITY.HIGH]: { labelKey: 'High', variant: 'warning' },
  [TICKET_PRIORITY.URGENT]: { labelKey: 'Urgent', variant: 'danger' },
}

export const TICKET_CATEGORY = {
  TECHNICAL: 'technical',
  BILLING: 'billing',
  FINANCE: 'finance',
  ACCOUNT: 'account',
  FEATURE: 'feature',
  OTHER: 'other',
} as const
export type TicketCategory =
  (typeof TICKET_CATEGORY)[keyof typeof TICKET_CATEGORY]
export const TICKET_CATEGORY_VALUES = Object.values(TICKET_CATEGORY) as [
  TicketCategory,
  ...TicketCategory[],
]

export const TICKET_CATEGORIES: Record<TicketCategory, { labelKey: string }> = {
  [TICKET_CATEGORY.TECHNICAL]: { labelKey: 'Technical Issue' },
  [TICKET_CATEGORY.BILLING]: { labelKey: 'Billing' },
  [TICKET_CATEGORY.FINANCE]: { labelKey: 'Top-up / Order' },
  [TICKET_CATEGORY.ACCOUNT]: { labelKey: 'Account' },
  [TICKET_CATEGORY.FEATURE]: { labelKey: 'Feature Request' },
  [TICKET_CATEGORY.OTHER]: { labelKey: 'Other' },
}

// ---------- option builders（用于 faceted filter / select） ----------

export function getTicketStatusOptions(t: TFunction) {
  return TICKET_BOARD_ORDER.map((value) => ({
    label: t(TICKET_STATUSES[value].labelKey),
    value,
  }))
}

export function getTicketPriorityOptions(t: TFunction) {
  return TICKET_PRIORITY_VALUES.map((value) => ({
    label: t(TICKET_PRIORITIES[value].labelKey),
    value,
  }))
}

export function getTicketCategoryOptions(t: TFunction) {
  return TICKET_CATEGORY_VALUES.map((value) => ({
    label: t(TICKET_CATEGORIES[value].labelKey),
    value,
  }))
}

// ============================================================================
// 提示文案（i18n key）
// ============================================================================

export const TICKET_MESSAGES = {
  CREATE_SUCCESS: 'Ticket submitted',
  REPLY_SUCCESS: 'Reply sent',
  STATUS_UPDATED: 'Ticket updated',
  LOAD_FAILED: 'Failed to load tickets',
} as const
