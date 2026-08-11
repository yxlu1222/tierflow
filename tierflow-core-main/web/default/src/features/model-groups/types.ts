/*
Copyright (C) 2023-2026 TierFlow
*/

// 模型分组成员（对应后端 model.ModelGroupMember）。
export interface ModelGroupMember {
  id?: number
  group_id?: number
  channel_id: number
  model_name: string
  priority: number
}

// 模型分组（对应后端 model.ModelGroup）。
export interface ModelGroup {
  id: number
  name: string
  description: string
  enabled: boolean
  members?: ModelGroupMember[]
  created_time?: number
  updated_time?: number
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

// 表单里每个成员行携带的可编辑状态：渠道 / 模型 / 优先级。
// 定价（售价、成本）统一在「模型管理」页按模型设置,成员不再单独覆盖。
export interface MemberFormRow {
  // 用于 React key，与后端无关。
  rowKey: string
  channel_id: number | null
  model_name: string
  priority: number
}

export interface ModelGroupFormValues {
  name: string
  description: string
  enabled: boolean
  members: MemberFormRow[]
}
