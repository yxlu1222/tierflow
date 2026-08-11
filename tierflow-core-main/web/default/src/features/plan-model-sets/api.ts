/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type { ModelGroup } from '@/features/model-groups/types'

// 套餐模型组(对应后端 model.PlanModelSet):套餐额度桶引用的模型组集合。

export interface PlanModelSetMember {
  id?: number
  set_id?: number
  model_group_id: number
}

export interface PlanModelSet {
  id: number
  name: string
  description: string
  enabled: boolean
  members?: PlanModelSetMember[]
  created_time?: number
  updated_time?: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export async function getPlanModelSets(): Promise<ApiResponse<PlanModelSet[]>> {
  const res = await api.get('/api/plan_model_set/')
  return res.data
}

export interface PlanModelSetPayload {
  name: string
  description: string
  enabled: boolean
  members: Pick<PlanModelSetMember, 'model_group_id'>[]
}

export async function createPlanModelSet(
  data: PlanModelSetPayload
): Promise<ApiResponse<PlanModelSet>> {
  const res = await api.post('/api/plan_model_set/', data)
  return res.data
}

export async function updatePlanModelSet(
  data: PlanModelSetPayload & { id: number }
): Promise<ApiResponse<PlanModelSet>> {
  const res = await api.put('/api/plan_model_set/', data)
  return res.data
}

export async function deletePlanModelSet(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/plan_model_set/${id}`)
  return res.data
}

// 模型组下拉数据(复用模型组管理接口)
export async function getModelGroupsForPicker(): Promise<
  ApiResponse<ModelGroup[]>
> {
  const res = await api.get('/api/model_group/')
  return res.data
}
