/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 用户端套餐订阅区块(充值页 + /subscription 独立页共用)。
 * 设计语言对齐 /pricing 营销页:大字价格、双额度桶(高级 ¥ + 基础 token)、
 * 细线 check 卖点、推荐徽章——但用面板语义 token(bg-card/muted/primary)
 * 以适配暗色主题,不引用 landing 的 --tf-* 变量。
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { RefreshCw, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota, quotaUnitsToDollars } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { dotColorMap, textColorMap } from '@/components/status-badge'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { formatDuration, formatResetPeriod } from '@/features/subscriptions/lib'
import {
  getPlanPurchasability,
  pickUpgradeAnchor,
} from '@/features/subscriptions/lib/selectors'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import type { PaymentMethod, TopupInfo } from '../types'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  onAvailabilityChange?: (available: boolean) => void
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
  /** 加载完成后自动打开该套餐的购买弹窗(来自 /pricing 的 ?plan=<id> 直达) */
  autoOpenPlanId?: number
}

function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter((m) => !!m?.type)
}

export function SubscriptionPlansCard({
  topupInfo,
  onAvailabilityChange,
  userQuota,
  onPurchaseSuccess,
  autoOpenPlanId,
}: SubscriptionPlansCardProps) {
  const { t, i18n } = useTranslation()

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  // ?plan 直达只消费一次,避免用户手动关闭后又被弹开
  const [autoOpenConsumed, setAutoOpenConsumed] = useState(false)

  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  const fetchPlans = useCallback(async () => {
    try {
      const res = await getPublicPlans()
      if (res.success) {
        setPlans(res.data || [])
      }
    } catch {
      setPlans([])
    }
  }, [])

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = await getSelfSubscriptionFull()
      if (res.success && res.data) {
        setActiveSubscriptions(res.data.subscriptions || [])
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchSelfSubscription])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchSelfSubscription()
    } finally {
      setRefreshing(false)
    }
  }

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0
  const isAvailable = loading || plans.length > 0 || hasAny
  // 升级源 = 锚点(生效订阅中快照价最高者),与置灰判定共用同一口径
  const upgradableFrom = hasActive
    ? (pickUpgradeAnchor(activeSubscriptions)?.subscription ?? null)
    : null

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
    onAvailabilityChange?.(isAvailable)
  }, [isAvailable, onAvailabilityChange])

  useEffect(() => {
    if (!autoOpenPlanId || autoOpenConsumed || loading) return
    const target = plans.find((p) => p.plan?.id === autoOpenPlanId)
    if (!target) return
    // 延迟到下一拍打开,避免 effect 内同步 setState 触发级联渲染
    const timer = setTimeout(() => {
      setAutoOpenConsumed(true)
      setSelectedPlan(target)
      setPurchaseOpen(true)
    }, 0)
    return () => clearTimeout(timer)
  }, [autoOpenPlanId, autoOpenConsumed, loading, plans])

  // 与 /pricing 营销页一致:按价格升序展示(接口默认按 sort_order desc)
  const sortedPlans = useMemo(
    () =>
      plans
        .slice()
        .sort(
          (a, b) =>
            Number(a.plan?.price_amount || 0) -
            Number(b.plan?.price_amount || 0)
        ),
    [plans]
  )

  // 推荐标记规则与 /pricing 一致:由管理端「推荐」开关控制

  const planTitleMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan.title || '')
      }
    }
    return map
  }, [plans])

  // 500 万 / 5M 这类紧凑 token 计数,跟随界面语言
  const compactNumber = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  )

  const getRemainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime) return 0
    const now = Date.now() / 1000
    return Math.max(0, Math.ceil((endTime - now) / 86400))
  }

  if (loading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-24 w-full rounded-2xl' />
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-80 w-full rounded-2xl' />
          ))}
        </div>
      </div>
    )
  }

  if (plans.length === 0 && !hasAny) {
    return null
  }

  const activeSubs = allSubscriptions.filter((sub) => {
    const s = sub?.subscription
    const now = Date.now() / 1000
    return s?.status === 'active' && (s?.end_time || 0) >= now
  })
  const inactiveSubs = allSubscriptions.filter(
    (sub) => !activeSubs.includes(sub)
  )

  return (
    <>
      <section className='space-y-8 sm:space-y-10'>
        {/* 我的订阅:有记录才出现,当前生效的展示双桶用量,历史只留一行 */}
        {hasAny && (
          <div className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <div className='flex flex-wrap items-baseline gap-x-2.5 gap-y-1'>
                <h3 className='text-sm font-semibold tracking-tight'>
                  {t('My Subscriptions')}
                </h3>
                {hasActive ? (
                  <span
                    className={cn('text-xs font-medium', textColorMap.success)}
                  >
                    {activeSubscriptions.length} {t('active')}
                  </span>
                ) : (
                  <span className='text-muted-foreground text-xs'>
                    {t('No Active')}
                  </span>
                )}
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='h-7 w-7'
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw
                  className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')}
                />
              </Button>
            </div>

            {activeSubs.map((sub) => {
              const subscription = sub.subscription
              const totalAmount = Number(subscription?.amount_total || 0)
              const usedAmount = Number(subscription?.amount_used || 0)
              const premiumPercent =
                totalAmount > 0
                  ? Math.round((usedAmount / totalAmount) * 100)
                  : 0
              const basicTotal = Number(subscription?.basic_token_total || 0)
              const basicUsed = Number(subscription?.basic_token_used || 0)
              const basicPercent =
                basicTotal > 0
                  ? Math.round((basicUsed / basicTotal) * 100)
                  : 0
              const planTitle = planTitleMap.get(subscription?.plan_id) || ''
              const remainDays = getRemainingDays(sub)

              return (
                <div
                  key={subscription?.id}
                  className='bg-card rounded-2xl border p-4 sm:p-5'
                >
                  <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
                    <div className='flex items-center gap-2'>
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          dotColorMap.success
                        )}
                        aria-hidden='true'
                      />
                      <span className='text-sm font-medium'>
                        {planTitle ||
                          `${t('Subscription')} #${subscription?.id}`}
                      </span>
                    </div>
                    <span className='text-muted-foreground text-xs tabular-nums'>
                      {t('{{count}} days remaining', { count: remainDays })}
                    </span>
                  </div>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t('Until')}{' '}
                    {new Date(
                      (subscription?.end_time || 0) * 1000
                    ).toLocaleString()}
                    {(subscription?.next_reset_time ?? 0) > 0 && (
                      <>
                        {' · '}
                        {t('Next reset')}:{' '}
                        {new Date(
                          subscription!.next_reset_time! * 1000
                        ).toLocaleString()}
                      </>
                    )}
                  </p>

                  <div className='mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2'>
                    <div>
                      <div className='flex items-baseline justify-between gap-2'>
                        <span className='text-muted-foreground text-xs'>
                          {t('Premium model credit')}
                        </span>
                        <span className='text-xs font-medium tabular-nums'>
                          {totalAmount > 0
                            ? `${formatQuota(usedAmount)} / ${formatQuota(totalAmount)}`
                            : t('Unlimited')}
                        </span>
                      </div>
                      {totalAmount > 0 && (
                        <Progress
                          value={premiumPercent}
                          className='mt-1.5 h-1'
                        />
                      )}
                    </div>
                    {basicTotal !== 0 && (
                      <div>
                        <div className='flex items-baseline justify-between gap-2'>
                          <span className='text-muted-foreground text-xs'>
                            {t('Basic model tokens')}
                          </span>
                          <span className='text-xs font-medium tabular-nums'>
                            {basicTotal === -1
                              ? `${t('Unlimited')} · ${t('Used')} ${basicUsed.toLocaleString()}`
                              : `${basicUsed.toLocaleString()} / ${basicTotal.toLocaleString()}`}
                          </span>
                        </div>
                        {basicTotal > 0 && (
                          <Progress
                            value={basicPercent}
                            className='mt-1.5 h-1'
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {inactiveSubs.length > 0 && (
              <div className='max-h-40 space-y-1.5 overflow-y-auto px-1'>
                {inactiveSubs.map((sub) => {
                  const subscription = sub.subscription
                  const planTitle =
                    planTitleMap.get(subscription?.plan_id) || ''
                  const isCancelled = subscription?.status === 'cancelled'
                  return (
                    <div
                      key={subscription?.id}
                      className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs'
                    >
                      <span
                        className={cn(
                          'size-1.5 shrink-0 rounded-full',
                          dotColorMap.neutral
                        )}
                        aria-hidden='true'
                      />
                      <span>
                        {planTitle ||
                          `${t('Subscription')} #${subscription?.id}`}
                      </span>
                      <span className='text-muted-foreground/40'>·</span>
                      <span>{isCancelled ? t('Cancelled') : t('Expired')}</span>
                      <span className='text-muted-foreground/40'>·</span>
                      <span>
                        {new Date(
                          (subscription?.end_time || 0) * 1000
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* 套餐网格 */}
        {plans.length > 0 ? (
          <div className='space-y-3'>
            {hasAny && (
              <h3 className='text-sm font-semibold tracking-tight'>
                {t('Choose a plan')}
              </h3>
            )}
            <div
              className={cn(
                'grid grid-cols-1 gap-4 md:grid-cols-2',
                sortedPlans.length === 3 && 'xl:grid-cols-3',
                sortedPlans.length >= 4 && 'xl:grid-cols-4'
              )}
            >
              {sortedPlans.map((p) => {
                const plan = p?.plan
                if (!plan) return null
                const totalAmount = Number(plan.total_amount || 0)
                const price = Number(Number(plan.price_amount || 0).toFixed(2))
                const isRecommended = plan.recommended === true
                const limit = Number(plan.max_purchase_per_user || 0)
                const count = planPurchaseCountMap.get(plan.id) || 0
                const reached = limit > 0 && count >= limit
                // 可购性(与后端拦截同一规则):blocked = 低/平级的其它套餐,置灰
                const purchasability = getPlanPurchasability(
                  plan,
                  activeSubscriptions
                )

                // 高级桶按营销页口径折算成 ¥,溢出部分做「多送」徽章
                const advancedCredit =
                  Math.round(quotaUnitsToDollars(totalAmount) * 10) / 10
                const bonus = Number((advancedCredit - price).toFixed(1))
                const basicTokenTotal = Number(plan.basic_token_total || 0)

                const features = [
                  t('Valid for {{duration}}, no auto-renewal', {
                    duration: formatDuration(plan, t),
                  }),
                  formatResetPeriod(plan, t) !== t('No Reset')
                    ? `${t('Quota Reset')}: ${formatResetPeriod(plan, t)}`
                    : null,
                  t('Dedicated API key, billed separately from balance'),
                  basicTokenTotal !== 0 && totalAmount > 0
                    ? t(
                        'Falls back to basic models when premium credit runs out'
                      )
                    : null,
                  limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
                  plan.upgrade_group
                    ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                    : null,
                ].filter(Boolean) as string[]

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      'bg-card relative flex h-full flex-col rounded-2xl border p-5 transition-shadow hover:shadow-md sm:p-6',
                      isRecommended && 'border-primary shadow-sm'
                    )}
                  >
                    {isRecommended && (
                      <span className='bg-primary text-primary-foreground absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[11px] font-semibold whitespace-nowrap'>
                        {t('Recommended')}
                      </span>
                    )}

                    <h4 className='text-[17px] font-semibold tracking-tight'>
                      {plan.title}
                    </h4>
                    <p className='text-muted-foreground mt-1 min-h-9 text-xs leading-relaxed'>
                      {plan.subtitle || ''}
                    </p>

                    {/* 周期文案 shrink-0 + nowrap,防止被宽价格挤压折行(同 /pricing) */}
                    <div className='mt-4 flex items-baseline gap-1.5'>
                      <span className='text-4xl font-semibold tracking-tight whitespace-nowrap tabular-nums'>
                        ¥{price}
                      </span>
                      <span className='text-muted-foreground shrink-0 text-xs whitespace-nowrap'>
                        / {formatDuration(plan, t)}
                      </span>
                    </div>

                    {/* 双额度桶 */}
                    <div className='mt-5 space-y-2'>
                      <div className='bg-muted/50 rounded-xl px-4 py-3'>
                        <div className='text-muted-foreground text-[11px]'>
                          {t('Premium model credit')}
                        </div>
                        <div className='mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                          <span className='text-lg font-semibold tabular-nums'>
                            {totalAmount > 0
                              ? `¥${advancedCredit}`
                              : t('Unlimited')}
                          </span>
                          {totalAmount > 0 && bonus > 0 && (
                            <span className='bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums'>
                              {t('Extra ¥{{amount}}', { amount: bonus })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className='bg-muted/50 rounded-xl px-4 py-3'>
                        <div className='text-muted-foreground text-[11px]'>
                          {t('Basic model tokens')}
                        </div>
                        <div className='mt-0.5 text-lg font-semibold tabular-nums'>
                          {basicTokenTotal === -1
                            ? t('Unlimited')
                            : basicTokenTotal === 0
                              ? '—'
                              : t('{{amount}} tokens', {
                                  amount: compactNumber.format(basicTokenTotal),
                                })}
                        </div>
                      </div>
                    </div>

                    <ul className='mt-5 flex flex-1 flex-col gap-2'>
                      {features.map((label) => (
                        <li
                          key={label}
                          className='text-muted-foreground flex items-start gap-2 text-xs leading-relaxed'
                        >
                          <Check className='text-primary mt-0.5 h-3.5 w-3.5 shrink-0' />
                          <span>{label}</span>
                        </li>
                      ))}
                    </ul>

                    {reached ? (
                      <Tooltip>
                        <TooltipTrigger render={<div className='mt-6' />}>
                          <Button variant='outline' className='w-full' disabled>
                            {t('Limit Reached')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('Purchase limit reached')} ({count}/{limit})
                        </TooltipContent>
                      </Tooltip>
                    ) : purchasability === 'blocked' ? (
                      <Tooltip>
                        <TooltipTrigger render={<div className='mt-6' />}>
                          <Button variant='outline' className='w-full' disabled>
                            {t('Not Downgradable')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(
                            'You already have an active plan at this tier or higher'
                          )}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant={isRecommended ? 'default' : 'outline'}
                        className='mt-6 w-full'
                        onClick={() => {
                          setSelectedPlan(p)
                          setPurchaseOpen(true)
                        }}
                      >
                        {purchasability === 'upgrade'
                          ? t('Upgrade')
                          : t('Subscribe Now')}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            {t('No plans available')}
          </p>
        )}
      </section>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            fetchSelfSubscription()
          }
        }}
        plan={selectedPlan}
        upgradeFrom={
          getPlanPurchasability(selectedPlan?.plan, activeSubscriptions) ===
          'upgrade'
            ? upgradableFrom
            : null
        }
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
        userQuota={userQuota}
        onPurchaseSuccess={onPurchaseSuccess}
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
    </>
  )
}
