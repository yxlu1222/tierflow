/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 订阅记录的公共派生逻辑。
 *
 * 「哪些订阅算生效」和「plan_id → 套餐」这两件事,用量信息页(/usage)和套餐页
 * (/subscription)都要做。抽在这里是为了让「生效」只有一个定义 —— 两处各写一遍
 * 的话,以后调整判定条件(比如把 cancelled 但未到期的算作生效)必然漏掉一处,
 * 而两个页面对同一个账户显示不同的订阅状态是最难排查的那类 bug。
 */
import type {
  PlanRecord,
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '../types'

/**
 * 按「是否生效」切分订阅记录。生效 = status 为 active 且未到期。
 *
 * 生效的一组按到期时间升序 —— 调用方普遍取 `[0]` 当作「当前套餐」(用量页显示
 * 额度、套餐页作为升级的差价基准),最早到期的那条才是即将影响用户的那条。
 *
 * @param nowSec 当前时间(unix 秒)。由调用方传入而不是在这里读时钟:渲染期直接
 *   调 Date.now() 会被 react-hooks/purity 拦下,且传入才能保证同一帧内判定一致。
 */
export function partitionSubscriptions(
  records: UserSubscriptionRecord[],
  nowSec: number
): { active: UserSubscriptionRecord[]; inactive: UserSubscriptionRecord[] } {
  const active: UserSubscriptionRecord[] = []
  const inactive: UserSubscriptionRecord[] = []

  for (const record of records) {
    const s = record?.subscription
    if (s?.status === 'active' && (s?.end_time || 0) >= nowSec) active.push(record)
    else inactive.push(record)
  }

  active.sort(
    (a, b) => (a.subscription?.end_time || 0) - (b.subscription?.end_time || 0)
  )

  return { active, inactive }
}

/**
 * 升级锚点:生效订阅中快照价(paid_money)最高者;并列时取最早到期。
 *
 * 置灰判定与「升级源订阅」必须共用同一锚点 —— 若置灰按最高价、升级源却取最早
 * 到期,一个显示「升级」的套餐可能实际升级另一条订阅,报价对不上。
 * 入参应传 partitionSubscriptions 的 active 组(已按到期升序)。
 */
export function pickUpgradeAnchor(
  active: UserSubscriptionRecord[]
): UserSubscriptionRecord | null {
  let anchor: UserSubscriptionRecord | null = null
  for (const record of active) {
    const paid = Number(record?.subscription?.paid_money || 0)
    const anchorPaid = Number(anchor?.subscription?.paid_money || 0)
    if (!anchor || paid > anchorPaid) anchor = record
  }
  return anchor
}

/**
 * 有生效订阅时某套餐的可购性,与后端 checkActivePurchaseAllowedTx 同一规则:
 * - purchasable:无生效订阅,正常购买
 * - renewable:目标 = 任一生效订阅的套餐 → 同套餐叠加续费(受购买上限约束)
 * - upgrade:价格 > 锚点快照价 → 仅升级通道(补差价替换)
 * - blocked:其余(低/平级的其它套餐)→ 置灰不可购买
 */
export type PlanPurchasability =
  | 'purchasable'
  | 'renewable'
  | 'upgrade'
  | 'blocked'

export function getPlanPurchasability(
  plan: { id?: number; price_amount?: number | string } | null | undefined,
  active: UserSubscriptionRecord[]
): PlanPurchasability {
  if (!active.length) return 'purchasable'
  if (
    plan?.id &&
    active.some((r) => r?.subscription?.plan_id === plan.id)
  ) {
    return 'renewable'
  }
  const anchor = pickUpgradeAnchor(active)
  const anchorPaid = Number(anchor?.subscription?.paid_money || 0)
  if (Number(plan?.price_amount || 0) > anchorPaid) return 'upgrade'
  return 'blocked'
}

/**
 * plan_id → 套餐定义。
 *
 * 套餐名/周期/副标题都不在 /api/subscription/self 里,只能拿 plan_id 跟 /plans
 * 客户端 join;join 不上时调用方应当降级渲染(仍能显示额度,只是没有标题)。
 */
export function buildPlanMap(
  planRecords: PlanRecord[]
): Map<number, SubscriptionPlan> {
  const map = new Map<number, SubscriptionPlan>()
  for (const record of planRecords) {
    if (record?.plan?.id) map.set(record.plan.id, record.plan)
  }
  return map
}
