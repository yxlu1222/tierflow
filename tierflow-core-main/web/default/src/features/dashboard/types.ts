/*
Copyright (C) 2023-2026 TierFlow
*/
import type { TimeGranularity } from '@/lib/time'

// ============================================================================
// Quota & Usage Data Types
// ============================================================================

export interface QuotaDataItem {
  id?: number
  user_id?: number
  username?: string
  /** 请求方案名(链路第 ① 层);后端 QuotaData.Strategy */
  strategy?: string
  /** 路由命中的模型组名快照(第 ② 层);直连请求为空 */
  model_group?: string
  /** 计费来源快照:'wallet' | 'subscription';历史行为空(归入钱包口径) */
  billing_source?: string
  /** 订阅扣费命中的桶:'premium' | 'basic';非订阅为空 */
  subscription_bucket?: string
  created_at: number
  token_used?: number
  count?: number
  quota?: number
}

// ============================================================================
// Finance (admin) Types
// ============================================================================

// 单个小时桶的资金数据点（与后端 model.FinancePoint 对应）。
// 来源拆分字段为可选：旧后端(未部署订阅口径拆分)不下发时按 0 处理。
export interface FinancePoint {
  created_at: number // 小时桶起点(unix 秒)
  recharge: number // 充值总额(支付货币；含余额购买套餐)
  recharge_count: number
  recharge_cash?: number // 现金流入(排除余额购买)
  recharge_wallet?: number // 其中钱包充值
  recharge_subscription?: number // 其中套餐现金购买
  recharge_from_balance?: number // 套餐余额购买(钱包内部转移,不计现金)
  revenue: number // 消费营收(quota)
  revenue_wallet?: number // 钱包实扣(含迁移前历史日志)
  revenue_subscription?: number // 订阅额度消耗(名义售价)
  revenue_subscription_basic?: number // 其中 basic 桶
  provider_cost: number // 上游成本(quota)
  margin: number // 毛利(quota)
  count: number // 消费请求数
}

// 资金看板返回体（与后端 model.FinanceSummary 对应）。
export interface FinanceSummary {
  start_timestamp: number
  end_timestamp: number
  points: FinancePoint[]
  total_recharge: number
  total_recharge_count: number
  total_recharge_cash?: number
  total_recharge_wallet?: number
  total_recharge_subscription?: number
  total_recharge_from_balance?: number
  total_revenue: number
  total_revenue_wallet?: number
  total_revenue_subscription?: number
  total_revenue_subscription_basic?: number
  total_provider_cost: number
  total_margin: number
  total_requests: number
  current_balance: number // 当前全站总余额(quota)
}

// ============================================================================
// Dashboard Filter Types
// ============================================================================

export interface DashboardFilters {
  start_timestamp?: Date
  end_timestamp?: Date
  time_granularity?: TimeGranularity
  username?: string
}

export type ConsumptionDistributionChartType = 'bar' | 'area'

export type ModelAnalyticsChartTab = 'trend' | 'proportion' | 'top'

export interface DashboardChartPreferences {
  consumptionDistributionChart: ConsumptionDistributionChartType
  modelAnalyticsChart: ModelAnalyticsChartTab
  defaultTimeRangeDays: number
  defaultTimeGranularity: TimeGranularity
}

// ============================================================================
// Chart Types
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VChartSpec = Record<string, any>

export interface ProcessedChartData {
  spec_pie: VChartSpec
  spec_line: VChartSpec
  spec_area: VChartSpec
  spec_model_line: VChartSpec
  spec_rank_bar: VChartSpec
  totalQuotaDisplay: string
  totalCountDisplay: string
}

export interface ProcessedUserChartData {
  spec_user_rank: VChartSpec
  spec_user_trend: VChartSpec
}

// ============================================================================
// Revenue & Margin Types (admin-only)
// ============================================================================

// All monetary fields below are raw quota integers (no currency conversion).
export interface CostSummary {
  days: number
  requests: number
  revenue: number
  provider_cost: number
  margin: number
}

export interface CostBucket {
  bucket_start: number
  requests: number
  revenue: number
  provider_cost: number
  margin: number
}

export type CostPeriod = 'day' | 'week' | 'month'

export interface CostTimeSeries {
  period: string
  start: number
  end: number
  requests: number
  revenue: number
  provider_cost: number
  margin: number
  buckets: CostBucket[]
}

// Row returned by cost_by_model / cost_by_channel (already sorted by revenue desc).
export interface CostDimensionRow {
  key: string
  label: string
  requests: number
  revenue: number
  provider_cost: number
  margin: number
}
