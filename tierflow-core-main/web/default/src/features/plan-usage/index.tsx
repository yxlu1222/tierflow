/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 套餐用量页(/subscription)—— 用户面板侧边栏入口。
 *
 * 这里只展示「我买了什么、还剩多少、用了多少」。套餐详情/选档不再重复渲染:
 * 营销页 /pricing 已经是套餐详情的唯一出处,「管理订阅」跳过去选档,点
 * 「立即开通」带 ?plan=<id> 回到本页,由下面挂载的购买弹窗接住(升级同理,
 * 补差价报价在弹窗内)。充值页 /recharge 仍保留完整的售卖卡片,不受影响。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getSelf } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionPageLayout } from '@/components/layout'
import { useTopupInfo } from '@/features/recharge/hooks'
import type { PaymentMethod, UserWalletData } from '@/features/recharge/types'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import {
  buildPlanMap,
  getPlanPurchasability,
  partitionSubscriptions,
  pickUpgradeAnchor,
} from '@/features/subscriptions/lib/selectors'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { CurrentPlanSection } from './components/current-plan-section'
import { UsageSection } from './components/usage-section'
import { useNowSeconds } from './hooks/use-now-seconds'

interface Props {
  /** 从 URL ?plan=<id> 传入,加载后自动打开该套餐的购买弹窗 */
  autoOpenPlanId?: number
}

export function PlanUsagePage({ autoOpenPlanId }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const now = useNowSeconds()
  const { topupInfo } = useTopupInfo()

  const [user, setUser] = useState<UserWalletData | null>(null)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  // ?plan 直达只消费一次,避免用户手动关闭后又被弹开
  const [autoOpenConsumed, setAutoOpenConsumed] = useState(false)

  const fetchUser = useCallback(async () => {
    try {
      const res = await getSelf()
      if (res.success && res.data) setUser(res.data as UserWalletData)
    } catch {
      // ignore
    }
  }, [])

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) setPlans(res.data || [])
    } catch {
      setPlans([])
    }
  }, [])

  const fetchSubscriptions = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchUser(), fetchPlans(), fetchSubscriptions()])
      setLoading(false)
    }
    void init()
  }, [fetchUser, fetchPlans, fetchSubscriptions])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([fetchUser(), fetchSubscriptions()])
    } finally {
      setRefreshing(false)
    }
  }, [fetchUser, fetchSubscriptions])

  // 套餐名/周期/副标题都不在 /api/subscription/self 里,得按 plan_id 跟 /plans
  // 客户端 join;判定与 join 都与用量信息页共用一份(subscriptions/lib/selectors)
  const planMap = useMemo(() => buildPlanMap(plans), [plans])

  const { activeSubs, inactiveSubs } = useMemo(() => {
    const { active, inactive } = partitionSubscriptions(allSubscriptions, now)
    return { activeSubs: active, inactiveSubs: inactive }
  }, [allSubscriptions, now])

  // 升级源 = 锚点(生效订阅中快照价最高者),与置灰/拦截判定共用同一口径
  const upgradableFrom = pickUpgradeAnchor(activeSubs)?.subscription ?? null

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  useEffect(() => {
    if (!autoOpenPlanId || autoOpenConsumed || loading) return
    const target = plans.find((p) => p.plan?.id === autoOpenPlanId)
    if (!target) return
    // 低/平级套餐直达拦截:与售卖卡片置灰同一规则,不弹购买框只提示
    const blocked = getPlanPurchasability(target.plan, activeSubs) === 'blocked'
    // 两条分支都延迟到下一拍:effect 内同步 setState 会触发级联渲染。
    // 拦截分支同样要消费掉 ?plan,否则 plans/activeSubs 的引用一变就重复弹提示。
    const timer = setTimeout(() => {
      setAutoOpenConsumed(true)
      if (blocked) {
        toast.info(t('You already have an active plan at this tier or higher'))
        return
      }
      setSelectedPlan(target)
      setPurchaseOpen(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [autoOpenPlanId, autoOpenConsumed, loading, plans, activeSubs, t])

  const epayMethods = useMemo(
    () =>
      (topupInfo?.pay_methods || []).filter((m: PaymentMethod) => !!m?.type),
    [topupInfo?.pay_methods]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Plan Usage')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-8 sm:space-y-10'>
          {loading ? (
            <Skeleton className='h-40 w-full rounded-2xl' />
          ) : (
            <CurrentPlanSection
              activeSubs={activeSubs}
              inactiveSubs={inactiveSubs}
              planMap={planMap}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              onManage={() => navigate({ to: '/pricing' })}
            />
          )}

          <UsageSection />
        </div>

        {/* SectionPageLayout 只渲染具名插槽,弹窗必须挂在 Content 里 */}
        <SubscriptionPurchaseDialog
          open={purchaseOpen}
          onOpenChange={(open) => {
            setPurchaseOpen(open)
            if (!open) void handleRefresh()
          }}
          plan={selectedPlan}
          upgradeFrom={
            getPlanPurchasability(selectedPlan?.plan, activeSubs) === 'upgrade'
              ? upgradableFrom
              : null
          }
          enableOnlineTopUp={!!topupInfo?.enable_online_topup}
          epayMethods={epayMethods}
          userQuota={user?.quota}
          onPurchaseSuccess={handleRefresh}
          purchaseLimit={
            selectedPlan?.plan?.max_purchase_per_user
              ? Number(selectedPlan.plan.max_purchase_per_user)
              : undefined
          }
          purchaseCount={
            selectedPlan?.plan?.id
              ? planPurchaseCountMap.get(selectedPlan.plan.id)
              : undefined
          }
        />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
