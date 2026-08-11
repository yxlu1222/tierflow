/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  AdminSubscriptionOrder,
  AdminTopupOrder,
  ApiResponse,
  OrderListParams,
  PagedData,
  SubscriptionOrderAction,
  TopupOrderAction,
} from './types'

function buildOrderQuery(params: OrderListParams): string {
  const search = new URLSearchParams({
    p: String(params.p ?? 1),
    page_size: String(params.page_size ?? 20),
  })
  if (params.keyword) {
    search.append('keyword', params.keyword)
  }
  if (params.status) {
    search.append('status', params.status)
  }
  return search.toString()
}

// ============================================================================
// TopUp Orders (admin)
// ============================================================================

/** 全平台资金订单(充值 + 订阅订单的资金镜像),按订单号搜索、状态过滤 */
export async function getAdminTopupOrders(
  params: OrderListParams
): Promise<ApiResponse<PagedData<AdminTopupOrder>>> {
  const res = await api.get(`/api/user/topup?${buildOrderQuery(params)}`)
  return res.data
}

/** 处理资金订单:complete 补单 / void 作废 / refund 标记退款(回收额度) */
export async function resolveTopupOrder(
  tradeNo: string,
  action: TopupOrderAction
): Promise<ApiResponse> {
  const res = await api.post('/api/user/topup/resolve', {
    trade_no: tradeNo,
    action,
  })
  return res.data
}

// ============================================================================
// Subscription Orders (admin)
// ============================================================================

export async function getAdminSubscriptionOrders(
  params: OrderListParams
): Promise<ApiResponse<PagedData<AdminSubscriptionOrder>>> {
  const res = await api.get(
    `/api/subscription/admin/orders?${buildOrderQuery(params)}`
  )
  return res.data
}

/** 人工处理订阅订单:deliver 补发 / close 关单(线下退款) / expire 作废挂单 */
export async function resolveSubscriptionOrder(
  orderId: number,
  action: SubscriptionOrderAction
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/orders/${orderId}/resolve`,
    {
      action,
    }
  )
  return res.data
}
