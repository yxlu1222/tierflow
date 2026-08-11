/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 日志表的 URL search schema。
 *
 * 抽出来是因为日志表格不再有自己的页面:它内嵌在用量信息页(/usage)里,而
 * TanStack Router 会剥掉未在 validateSearch 里声明的 search 参数。**任何挂载
 * UsageLogsTable 的路由都必须 validateSearch 这套 schema**,否则筛选/翻页写不进
 * URL,点了等于没点。目前唯一的挂载点是 routes/_authenticated/usage.tsx。
 */
import z from 'zod'

const logTypeValues = ['0', '1', '2', '3', '4', '5', '6'] as const

const logTypeSearchSchema = z
  .preprocess(
    (value) => {
      if (value == null || value === '') return undefined
      return Array.isArray(value) ? value : [value]
    },
    z.array(z.enum(logTypeValues)).optional()
  )
  .catch([])

export const usageLogsSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  type: logTypeSearchSchema.optional(),
  filter: z.string().optional().catch(''),
  model: z.string().optional().catch(''),
  token: z.string().optional().catch(''),
  channel: z.string().optional().catch(''),
  group: z.string().optional().catch(''),
  username: z.string().optional().catch(''),
  requestId: z.string().optional().catch(''),
  upstreamRequestId: z.string().optional().catch(''),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
})

export type UsageLogsSearch = z.infer<typeof usageLogsSearchSchema>
