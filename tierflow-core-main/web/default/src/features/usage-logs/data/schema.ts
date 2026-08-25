/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Zod schemas for common logs
 * This file should only contain Zod schemas and types inferred from them
 */
import { z } from 'zod'

// Usage log schema
export const usageLogSchema = z.object({
  id: z.number(),
  /** 仅管理端返回;用户侧 /api/log/self 不下发 */
  user_id: z.number().optional(),
  created_at: z.number(),
  type: z.number(),
  content: z.string(),
  username: z.string().default(''),
  token_name: z.string().default(''),
  /** 请求方案名(链路第 ① 层);后端 Log.Strategy */
  strategy: z.string().default(''),
  // 路由命中的模型组名快照(第 ② 层);直连请求为空
  model_group: z.string().default(''),
  quota: z.number().default(0),
  prompt_tokens: z.number().default(0),
  completion_tokens: z.number().default(0),
  use_time: z.number().default(0),
  is_stream: z.boolean().default(false),
  channel: z.number().default(0),
  channel_name: z.string().nullish().default(''),
  token_id: z.number().default(0),
  group: z.string().default(''),
  ip: z.string().default(''),
  other: z.string().default(''),
  request_id: z.string().default(''),
  upstream_request_id: z.string().default(''),
})

export type UsageLog = z.infer<typeof usageLogSchema>
