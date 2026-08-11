/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  AdminListTicketsParams,
  AdminUpdateTicketPayload,
  ApiResponse,
  CreateTicketFormData,
  ListTicketsParams,
  PageResult,
  Ticket,
  TicketDetail,
  TicketMessage,
  TicketStats,
} from './types'

function toQuery(params: object): string {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

// ============================================================================
// 用户自助（/api/ticket/self）
// ============================================================================

export async function listMyTickets(
  params: ListTicketsParams = {}
): Promise<ApiResponse<PageResult<Ticket>>> {
  const res = await api.get(`/api/ticket/self${toQuery({ ...params })}`)
  return res.data
}

export async function createTicket(
  data: CreateTicketFormData
): Promise<ApiResponse<Ticket>> {
  const res = await api.post('/api/ticket/self', data)
  return res.data
}

export async function getMyTicketDetail(
  id: number
): Promise<ApiResponse<TicketDetail>> {
  const res = await api.get(`/api/ticket/self/${id}`)
  return res.data
}

export async function replyMyTicket(
  id: number,
  content: string
): Promise<ApiResponse<TicketMessage>> {
  const res = await api.post(`/api/ticket/self/${id}/reply`, { content })
  return res.data
}

// ============================================================================
// 管理端（/api/ticket/admin, /api/ticket/stats）
// ============================================================================

export async function adminListTickets(
  params: AdminListTicketsParams = {}
): Promise<ApiResponse<PageResult<Ticket>>> {
  const res = await api.get(`/api/ticket/admin${toQuery({ ...params })}`)
  return res.data
}

export async function adminGetTicketStats(): Promise<ApiResponse<TicketStats>> {
  const res = await api.get('/api/ticket/stats')
  return res.data
}

export async function adminGetTicketDetail(
  id: number
): Promise<ApiResponse<TicketDetail>> {
  const res = await api.get(`/api/ticket/admin/${id}`)
  return res.data
}

export async function adminReplyTicket(
  id: number,
  content: string
): Promise<ApiResponse<TicketMessage>> {
  const res = await api.post(`/api/ticket/admin/${id}/reply`, { content })
  return res.data
}

export async function adminUpdateTicket(
  id: number,
  payload: AdminUpdateTicketPayload
): Promise<ApiResponse<Ticket>> {
  const res = await api.put(`/api/ticket/admin/${id}`, payload)
  return res.data
}
