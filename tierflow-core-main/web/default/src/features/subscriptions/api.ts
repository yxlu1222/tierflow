/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  ApiResponse,
  PlanRecord,
  PlanPayload,
  UserSubscriptionRecord,
  CreateUserSubscriptionRequest,
  SubscriptionPayResponse,
  SubscriptionPayRequest,
  SelfSubscriptionData,
} from './types'

// ============================================================================
// Admin Plan Management
// ============================================================================

export async function getAdminPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/admin/plans')
  return res.data
}

export async function createPlan(
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.post('/api/subscription/admin/plans', data)
  return res.data
}

export async function updatePlan(
  id: number,
  data: PlanPayload
): Promise<ApiResponse<PlanRecord>> {
  const res = await api.put(`/api/subscription/admin/plans/${id}`, data)
  return res.data
}

export async function patchPlanStatus(
  id: number,
  enabled: boolean
): Promise<ApiResponse> {
  const res = await api.patch(`/api/subscription/admin/plans/${id}`, {
    enabled,
  })
  return res.data
}

/** 仅能删除从未产生订阅/订单的套餐;已售出的套餐后端会拒绝,请改用停用 */
export async function deletePlan(id: number): Promise<ApiResponse> {
  const res = await api.delete(`/api/subscription/admin/plans/${id}`)
  return res.data
}

// ============================================================================
// Admin User Subscription Management
// ============================================================================

export async function getUserSubscriptions(
  userId: number
): Promise<ApiResponse<UserSubscriptionRecord[]>> {
  const res = await api.get(
    `/api/subscription/admin/users/${userId}/subscriptions`
  )
  return res.data
}

export async function createUserSubscription(
  userId: number,
  data: CreateUserSubscriptionRequest
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/users/${userId}/subscriptions`,
    data
  )
  return res.data
}

export async function invalidateUserSubscription(
  subId: number
): Promise<ApiResponse<{ message?: string }>> {
  const res = await api.post(
    `/api/subscription/admin/user_subscriptions/${subId}/invalidate`
  )
  return res.data
}

export async function deleteUserSubscription(
  subId: number
): Promise<ApiResponse> {
  const res = await api.delete(
    `/api/subscription/admin/user_subscriptions/${subId}`
  )
  return res.data
}

// ============================================================================
// User-facing Subscription Payment
// ============================================================================

export async function paySubscriptionBalance(
  data: SubscriptionPayRequest
): Promise<SubscriptionPayResponse> {
  const res = await api.post('/api/subscription/balance/pay', data)
  return res.data
}

// ---- 升级(只升不降,D10):剩余价值 = 快照价 ÷ 30 × 剩余天数,补差价 ----

export interface SubscriptionUpgradeQuote {
  current_subscription_id: number
  current_plan_id: number
  current_paid_money: number
  remaining_days: number
  remaining_value: number
  target_plan_id: number
  target_price: number
  amount_due: number
}

export async function getUpgradeQuote(
  subscriptionId: number,
  planId: number
): Promise<ApiResponse<SubscriptionUpgradeQuote>> {
  const res = await api.get('/api/subscription/upgrade/quote', {
    params: { subscription_id: subscriptionId, plan_id: planId },
  })
  return res.data
}

export async function upgradeSubscription(data: {
  subscription_id: number
  plan_id: number
}): Promise<
  ApiResponse<{ token_key?: string; quote?: SubscriptionUpgradeQuote }>
> {
  const res = await api.post('/api/subscription/upgrade', data)
  return res.data
}

/** epay 下单响应的统一解包:url 的双源回退只存在这一份 */
async function postEpay(
  path: string,
  data: object
): Promise<SubscriptionPayResponse & { url?: string }> {
  const res = await api.post(path, data)
  return {
    ...res.data,
    url: res.data.url || (res as unknown as { url?: string }).url,
  }
}

export async function paySubscriptionEpay(
  data: SubscriptionPayRequest & { payment_method: string }
): Promise<SubscriptionPayResponse & { url?: string }> {
  return postEpay('/api/subscription/epay/pay', data)
}

/** 在线支付升级差价:创建 upgrade 订单并拉起 epay,升级由支付回调完成 */
export async function paySubscriptionUpgradeEpay(data: {
  subscription_id: number
  plan_id: number
  payment_method: string
}): Promise<SubscriptionPayResponse & { url?: string }> {
  return postEpay('/api/subscription/upgrade/epay', data)
}

// ============================================================================
// User Self Subscriptions
// ============================================================================

export async function getSelfSubscriptions(): Promise<
  ApiResponse<UserSubscriptionRecord[]>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getSelfSubscriptionFull(): Promise<
  ApiResponse<SelfSubscriptionData>
> {
  const res = await api.get('/api/subscription/self')
  return res.data
}

export async function getPublicPlans(): Promise<ApiResponse<PlanRecord[]>> {
  const res = await api.get('/api/subscription/plans')
  return res.data
}

export async function getGroups(): Promise<ApiResponse<string[]>> {
  const res = await api.get('/api/group')
  return res.data
}

// ============================================================================
// Subscription Dedicated Key (套餐专用 Key —— 不在 API 密钥页管理)
// ============================================================================

export interface SubscriptionTokenData {
  key: string
  name?: string
  status?: number
  expired_time?: number
}

export async function getSubscriptionKey(
  userSubscriptionId: number
): Promise<ApiResponse<SubscriptionTokenData>> {
  const res = await api.get('/api/subscription/self/token', {
    params: { id: userSubscriptionId },
  })
  return res.data
}

/** 重新签发:旧 Key 立即失效,调用前必须让用户二次确认 */
export async function rotateSubscriptionKey(
  userSubscriptionId: number
): Promise<ApiResponse<{ key: string }>> {
  const res = await api.post('/api/subscription/self/token/rotate', {
    id: userSubscriptionId,
  })
  return res.data
}
