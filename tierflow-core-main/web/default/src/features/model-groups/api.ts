/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type { GetChannelsResponse } from '@/features/channels/types'
import type { ApiResponse, ModelGroup, ModelGroupMember } from './types'

// ============================================================================
// Model group CRUD
// ============================================================================

export async function getModelGroups(): Promise<ApiResponse<ModelGroup[]>> {
  const res = await api.get('/api/model_group/')
  return res.data
}

export async function getModelGroup(
  id: number
): Promise<ApiResponse<ModelGroup>> {
  const res = await api.get(`/api/model_group/${id}`)
  return res.data
}

export interface ModelGroupPayload {
  name: string
  description: string
  enabled: boolean
  members: Pick<ModelGroupMember, 'channel_id' | 'model_name' | 'priority'>[]
}

export async function createModelGroup(
  data: ModelGroupPayload
): Promise<ApiResponse<ModelGroup>> {
  const res = await api.post('/api/model_group/', data)
  return res.data
}

export async function updateModelGroup(
  data: ModelGroupPayload & { id: number }
): Promise<ApiResponse<ModelGroup>> {
  const res = await api.put('/api/model_group/', data)
  return res.data
}

export async function deleteModelGroup(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/model_group/${id}`)
  return res.data
}

// ============================================================================
// Channel list (成员渠道选择)
// ============================================================================

export async function getChannelsForPicker(): Promise<GetChannelsResponse> {
  // 拉全部渠道（大 page_size），供成员行的渠道下拉。
  const res = await api.get('/api/channel', {
    params: { p: 1, page_size: 1000 },
  })
  return res.data
}
