/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 看板首屏第一块:左「我的套餐」+ 右「余额」。
 *
 * 两者是**互不串扣**的独立计费通道 —— 余额走按量付费,套餐走订阅制,套餐桶用尽
 * 后不会回落到余额扣费(该档模型直接不可用)。所以这里并排展示、各自说明,不做
 * 主从关系,也不把两者相加成一个「总额度」。
 */
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BucketMeter } from '@/features/subscriptions/components/bucket-meter'
import { usePlanSummary } from '../../hooks/use-plan-summary'

function PlanCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const {
    subscription,
    planTitle,
    hadSubscription,
    remainingDays,
    loading,
    isError,
    refetch,
  } = usePlanSummary()

  if (loading) {
    return (
      <section className='bg-card rounded-2xl border p-5 sm:p-6'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='mt-4 h-10 w-full' />
        <Skeleton className='mt-3 h-10 w-full' />
      </section>
    )
  }

  // 取数失败必须先于「未开通」判断 —— 两者的 subscription 都是 null,但把请求
  // 失败渲染成劝开通的 CTA,会让正在用套餐的付费用户以为自己的额度没了。
  if (isError) {
    return (
      <section className='bg-card flex flex-col rounded-2xl border p-5 sm:p-6'>
        <h3 className='text-base font-semibold tracking-tight'>
          {t('Current Subscription')}
        </h3>
        <p className='text-muted-foreground mt-1.5 text-sm'>
          {t('Failed to load subscription. Your plan is unaffected.')}
        </p>
        <div className='mt-auto pt-4'>
          <Button variant='outline' size='pill' onClick={refetch}>
            {t('Retry')}
          </Button>
        </div>
      </section>
    )
  }

  // 未开通 / 已过期:额度区换成 CTA,而不是渲染一张空卡
  if (!subscription) {
    return (
      <section className='bg-card flex flex-col rounded-2xl border p-5 sm:p-6'>
        <h3 className='text-base font-semibold tracking-tight'>
          {t('Current Subscription')}
        </h3>
        <p className='text-muted-foreground mt-1.5 text-sm'>
          {hadSubscription
            ? t('Your subscription has ended. Renew to restore plan quota.')
            : t('Subscribe to a plan to get a dedicated API key and quota.')}
        </p>
        <div className='mt-auto pt-4'>
          <Button size='pill' onClick={() => void navigate({ to: '/pricing' })}>
            {hadSubscription ? t('Renew') : t('View Plans')}
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section className='bg-card rounded-2xl border p-5 sm:p-6'>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
        <h3 className='text-base font-semibold tracking-tight'>
          {/* 套餐名原文直出,不追加「订阅」后缀:套餐名本身多已含「订阅」二字 */}
          {planTitle || t('Current Subscription')}
        </h3>
        <span className='text-muted-foreground text-sm tabular-nums'>
          {t('{{count}} days remaining', { count: remainingDays })}
        </span>
      </div>

      <div className='mt-4 space-y-4'>
        <BucketMeter
          label={t('Premium model credit')}
          total={Number(subscription.amount_total || 0)}
          used={Number(subscription.amount_used || 0)}
          format={formatQuota}
          zeroMeans='unlimited'
        />
        <BucketMeter
          label={t('Basic model tokens')}
          total={Number(subscription.basic_token_total || 0)}
          used={Number(subscription.basic_token_used || 0)}
          format={(v) => v.toLocaleString()}
          zeroMeans='hidden'
        />
      </div>

      <div className='mt-5 flex flex-wrap gap-2'>
        <Button
          variant='outline'
          size='pill'
          onClick={() => void navigate({ to: '/subscription' })}
        >
          {t('Manage Subscription')}
        </Button>
        <Button size='pill' onClick={() => void navigate({ to: '/pricing' })}>
          {t('Upgrade')}
        </Button>
      </div>
    </section>
  )
}

function BalanceCard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)

  const affQuota = Number(user?.aff_quota ?? 0)

  return (
    <section className='bg-card flex flex-col rounded-2xl border p-5 sm:p-6'>
      <h3 className='text-base font-semibold tracking-tight'>{t('Balance')}</h3>

      <div className='mt-4 text-[32px] leading-none font-semibold tracking-tight tabular-nums'>
        {formatQuota(Number(user?.quota ?? 0))}
      </div>

      {/* 两个次要指标垫住卡片下半部分,否则右卡比左边的套餐卡矮一大截、显空。
          邀请额度只在有值时出现 —— 邀请奖励功能可被管理员关掉。 */}
      <dl className='mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4'>
        <div>
          <dt className='text-muted-foreground text-xs'>{t('Used Quota')}</dt>
          <dd className='mt-1 text-sm font-medium tabular-nums'>
            {formatQuota(Number(user?.used_quota ?? 0))}
          </dd>
        </div>
        {affQuota > 0 && (
          <div>
            <dt className='text-muted-foreground text-xs'>
              {t('Invitation Quota')}
            </dt>
            <dd className='mt-1 text-sm font-medium tabular-nums'>
              {formatQuota(affQuota)}
            </dd>
          </div>
        )}
      </dl>

      <div className='mt-auto pt-5'>
        <Button size='pill' onClick={() => void navigate({ to: '/recharge' })}>
          {t('Top-up')}
        </Button>
      </div>
    </section>
  )
}

export function AccountStrip() {
  return (
    // 套餐卡内容多(两条额度进度 + 两个按钮),余额卡只有一个数字和两个小指标,
    // 所以比例拉到 2.4:1 —— 等宽会让右卡显得空。
    <div className='grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]'>
      <PlanCard />
      <BalanceCard />
    </div>
  )
}
