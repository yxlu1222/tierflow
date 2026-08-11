/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  ApiResponse,
  ModelGroup,
  RoutingProfile,
  RoutingProfileFormValues,
} from './types'

export async function getRoutingProfiles(): Promise<
  ApiResponse<RoutingProfile[]>
> {
  const res = await api.get('/api/routing_profile/')
  return res.data
}

// 模型分组列表（tier 下拉现在选分组，值为 "mg:<id>"）
export async function getModelGroups(): Promise<ApiResponse<ModelGroup[]>> {
  const res = await api.get('/api/model_group/')
  return res.data
}

export async function createRoutingProfile(
  data: RoutingProfileFormValues
): Promise<ApiResponse<RoutingProfile>> {
  const res = await api.post('/api/routing_profile/', data)
  return res.data
}

export async function updateRoutingProfile(
  data: RoutingProfileFormValues & { id: number }
): Promise<ApiResponse<RoutingProfile>> {
  const res = await api.put('/api/routing_profile/', data)
  return res.data
}

export async function deleteRoutingProfile(
  id: number
): Promise<ApiResponse> {
  const res = await api.delete(`/api/routing_profile/${id}`)
  return res.data
}
