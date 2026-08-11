/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'
import {
  TICKET_CATEGORY_VALUES,
  TICKET_PRIORITY_VALUES,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from './constants'

// ---------- 通用响应封装 ----------

export interface ApiResponse<T = unknown> {
  success: boolean
  message: string
  data: T
}

export interface PageResult<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}

// ---------- 领域模型（对应后端 JSON） ----------

export interface Ticket {
  id: number
  ticket_no: string
  /** 仅管理端返回;用户侧 /api/ticket/self 不下发 */
  user_id?: number
  title: string
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  /** 仅管理端返回;用户侧不下发 */
  assignee_id?: number
  last_reply_at: number
  last_reply_role: string
  created_at: number
  updated_at: number
  username?: string
}

export interface TicketMessage {
  id: number
  ticket_id: number
  /** 仅管理端返回;用户侧不下发 */
  author_id?: number
  author_role: 'user' | 'admin'
  content: string
  created_at: number
  author_name?: string
}

export interface TicketOwner {
  id: number
  username: string
  display_name: string
  email: string
  group: string
  status: number
  quota: number
  used_quota: number
  created_at: number
}

export interface TicketDetail {
  ticket: Ticket
  messages: TicketMessage[]
  owner?: TicketOwner | null
}

// ---------- 请求参数 ----------

export interface ListTicketsParams {
  p?: number
  page_size?: number
  status?: string
}

export interface AdminListTicketsParams extends ListTicketsParams {
  priority?: string
  category?: string
  assignee_id?: number
  user_id?: number
}

export interface AdminUpdateTicketPayload {
  status?: TicketStatus
  priority?: TicketPriority
  category?: TicketCategory
  assignee_id?: number
}

export type TicketStats = Record<TicketStatus, number>

// ---------- 新建工单表单（Zod） ----------

export const createTicketSchema = z.object({
  title: z.string().trim().min(1).max(255),
  category: z.enum(TICKET_CATEGORY_VALUES),
  priority: z.enum(TICKET_PRIORITY_VALUES),
  content: z.string().trim().min(1),
})

export type CreateTicketFormData = z.infer<typeof createTicketSchema>
