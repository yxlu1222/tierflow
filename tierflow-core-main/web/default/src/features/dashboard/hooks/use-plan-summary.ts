/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 看板首屏「我的套餐」摘要数据。
 *
 * 只回答三个问题:有没有在用的套餐、两个桶还剩多少、什么时候到期。选档/购买/
 * 升级仍然由 /pricing + /subscription 承担,这里不重复那套逻辑。
 *
 * 套餐名不在 /api/subscription/self 里,得按 plan_id 跟 /plans 客户端 join
 * (与 features/plan-usage 同一套做法)。
 */
import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNowSeconds } from '@/features/plan-usage/hooks/use-now-seconds'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import {
  buildPlanMap,
  partitionSubscriptions,
} from '@/features/subscriptions/lib/selectors'
import type {
  SubscriptionPlan,
  UserSubscription,
} from '@/features/subscriptions/types'

export interface PlanSummary {
  /** 当前生效的订阅(取最早到期的一条);没有则为 null。 */
  subscription: UserSubscription | null
  /** 对应的套餐定义,join 不上时为 null(仍可渲染额度,只是没有标题)。 */
  plan: SubscriptionPlan | null
  /**
   * 展示用套餐名:优先后端下发的 plan_title(按 plan_id 直查,不受套餐停用影响),
   * 客户端 join 的结果仅作兜底。套餐被硬删时为 null,由展示层退回通用标题。
   */
  planTitle: string | null
  /** 曾经买过但已过期/取消 —— 用来把文案从「开通」换成「续费」。 */
  hadSubscription: boolean
  /** 距到期天数(向上取整),无生效套餐时为 0。 */
  remainingDays: number
  loading: boolean
  /**
   * 订阅接口取数失败。必须与「没有订阅」区分开 —— 两者都会让 subscription 为
   * null,但一个该提示重试,另一个才该劝开通。把请求失败渲染成「未开通」会让
   * 付费用户以为自己的套餐没了。
   */
  isError: boolean
  /** 重新拉取订阅与套餐列表(错误态重试用)。 */
  refetch: () => void
}

export function usePlanSummary(): PlanSummary {
  // 渲染期不能直接读 Date.now()(react-hooks/purity);首帧为 0 表示时间未就绪,
  // 此时一律按 loading 处理,否则 `end_time >= 0` 会让过期套餐先闪一帧「生效」。
  const now = useNowSeconds()

  const subsQuery = useQuery({
    queryKey: ['dashboard', 'self-subscriptions'],
    queryFn: getSelfSubscriptionFull,
    staleTime: 60 * 1000,
  })

  const plansQuery = useQuery({
    queryKey: ['dashboard', 'public-plans'],
    queryFn: getPublicPlans,
    staleTime: 5 * 60 * 1000,
  })

  const all = useMemo(
    () => subsQuery.data?.data?.all_subscriptions ?? [],
    [subsQuery.data]
  )

  // query 对象本身不是引用稳定的,依赖数组里只能放解构出来的 refetch
  const { refetch: refetchSubs } = subsQuery
  const { refetch: refetchPlans } = plansQuery
  const refetch = useCallback(() => {
    void refetchSubs()
    void refetchPlans()
  }, [refetchSubs, refetchPlans])

  return useMemo(() => {
    // 「生效」的判定与套餐页共用一份(features/subscriptions/lib/selectors),
    // 两处各写一遍迟早会漂移成两种状态显示
    const { active } = partitionSubscriptions(all, now)
    const subscription = active[0]?.subscription ?? null
    const planMap = buildPlanMap(plansQuery.data?.data ?? [])
    const plan = subscription ? (planMap.get(subscription.plan_id) ?? null) : null

    return {
      subscription,
      plan,
      planTitle: subscription?.plan_title || plan?.title || null,
      hadSubscription: all.length > 0,
      remainingDays: subscription
        ? Math.max(0, Math.ceil(((subscription.end_time || 0) - now) / 86400))
        : 0,
      loading: now === 0 || subsQuery.isLoading || plansQuery.isLoading,
      // 只看订阅接口:套餐列表挂了顶多缺个标题,额度照样能渲染
      isError: subsQuery.isError,
      refetch,
    }
  }, [
    all,
    now,
    plansQuery.data,
    subsQuery.isLoading,
    plansQuery.isLoading,
    subsQuery.isError,
    refetch,
  ])
}
