/*
Copyright (C) 2023-2026 TierFlow
*/
// TierFlow 智能路由配置（对应后端 model.RoutingProfile）。
export interface RoutingProfile {
  id: number
  slug: string
  // name 已并入 slug（slug 同时充当唯一标识与展示名）。后端仍返回该字段，仅作兼容保留。
  name?: string
  aliases: string // 逗号分隔，用户请求用这些名字命中本 profile（如 "auto"）
  score_bands: string // "0-3:5,3-5:4,5-7:3,7-9:2,9-10:1"
  tier_1_model: string // tier1=最高难度
  tier_2_model: string
  tier_3_model: string // 无匹配/打分失败时兜底
  tier_4_model: string
  tier_5_model: string // tier5=最低难度
  multimodal_model: string // 含图片/音频等多模态输入时,跳过打分直接路由到此模型(留空=不启用)
  group: string
  enabled: boolean
  description: string
  keywords: string // 分号分隔，模型广场卡片下方展示（如 "编程;长上下文;Agent"）
  created_time?: number
  updated_time?: number
}

export type RoutingProfileFormValues = Omit<
  RoutingProfile,
  'id' | 'created_time' | 'updated_time' | 'name'
>

// 模型分组成员（对应后端 model.ModelGroupMember）。
export interface ModelGroupMember {
  id: number
  group_id: number
  channel_id: number
  model_name: string
  priority: number
}

// 模型分组（对应后端 model.ModelGroup）。tier 下拉现在选分组，值为 "mg:<id>"。
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
