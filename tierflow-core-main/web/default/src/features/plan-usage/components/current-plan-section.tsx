/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 「当前订阅」条 + 双桶额度。
 *
 * 售卖卡片不在这里:选档统一走营销页 /pricing(它已经是套餐详情的唯一出处),
 * 点「立即开通」会带 ?plan=<id> 回到本页自动弹购买/升级框。
 */
import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { dotColorMap } from '@/components/status-badge'
import { BucketMeter } from '@/features/subscriptions/components/bucket-meter'
import type {
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { useNowSeconds } from '../hooks/use-now-seconds'
import { SubscriptionKeyDialog } from './subscription-key-dialog'

interface CurrentPlanSectionProps {
  activeSubs: UserSubscriptionRecord[]
  inactiveSubs: UserSubscriptionRecord[]
  planMap: Map<number, SubscriptionPlan>
  refreshing: boolean
  onRefresh: () => void
  onManage: () => void
}

export function CurrentPlanSection(props: CurrentPlanSectionProps) {
  const { t } = useTranslation()
  const now = useNowSeconds()
  const { activeSubs, inactiveSubs, planMap } = props
  const hasActive = activeSubs.length > 0

  // 套餐专用 Key 的管理入口(API 密钥页已不再收录它)
  const [keyDialogSub, setKeyDialogSub] = useState<number | null>(null)

  const remainingDays = (sub: UserSubscriptionRecord) => {
    const endTime = sub?.subscription?.end_time || 0
    if (!endTime || !now) return 0
    return Math.max(0, Math.ceil((endTime - now) / 86400))
  }

  /**
   * 胶囊文案:直接用套餐名原文,不再追加「订阅」后缀 —— 正式环境的套餐名本身
   * 就带「订阅」二字(如「Pro 订阅」),拼后缀会显示成「Pro 订阅 订阅」。
   *
   * 套餐名优先取后端下发的 plan_title —— planMap 来自在售套餐列表,套餐一停用
   * (停用只应阻止新购)存量未过期订阅就会 join 不到、退化成「订阅 #id」。
   */
  const planLabel = (
    sub?: UserSubscriptionRecord['subscription'],
    fallbackId?: number
  ) => {
    const title =
      sub?.plan_title ||
      (sub?.plan_id ? planMap.get(sub.plan_id)?.title : undefined)
    if (!title) return `${t('Subscription')} #${fallbackId ?? sub?.id}`
    return title
  }

  return (
    <section className='space-y-3'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='text-base font-semibold tracking-tight'>
          {t('Current Subscription')}
        </h3>
        <div className='flex items-center gap-1.5'>
          <Button
            variant='ghost'
            size='icon'
            className='h-7 w-7'
            onClick={props.onRefresh}
            disabled={props.refreshing}
            aria-label={t('Refresh')}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', props.refreshing && 'animate-spin')}
            />
          </Button>
          <Button variant='outline' size='sm' onClick={props.onManage}>
            {hasActive ? t('Manage Subscription') : t('View Plans')}
          </Button>
        </div>
      </div>

      {hasActive ? (
        activeSubs.map((sub) => {
          const s = sub.subscription
          const plan = s?.plan_id ? planMap.get(s.plan_id) : undefined
          return (
            <div key={s?.id} className='bg-card rounded-2xl border p-5 sm:p-6'>
              <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className='bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium'>
                    <span
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        dotColorMap.success
                      )}
                      aria-hidden='true'
                    />
                    {planLabel(s)}
                  </span>
                </div>
                <div className='flex items-center gap-3'>
                  <span className='text-sm font-medium tabular-nums'>
                    {t('{{count}} days remaining', {
                      count: remainingDays(sub),
                    })}
                  </span>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => setKeyDialogSub(s?.id ?? null)}
                  >
                    {t('Subscription Key')}
                  </Button>
                </div>
              </div>

              {plan?.subtitle && (
                <p className='text-muted-foreground mt-2 text-sm'>
                  {plan.subtitle}
                </p>
              )}
              <p className='text-muted-foreground mt-1 text-sm'>
                {t('Until')}{' '}
                {new Date((s?.end_time || 0) * 1000).toLocaleString()}
                {(s?.next_reset_time ?? 0) > 0 && (
                  <>
                    {' · '}
                    {t('Next reset')}:{' '}
                    {new Date(s!.next_reset_time! * 1000).toLocaleString()}
                  </>
                )}
              </p>

              <div className='mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2'>
                <BucketMeter
                  label={t('Premium model credit')}
                  total={Number(s?.amount_total || 0)}
                  used={Number(s?.amount_used || 0)}
                  format={formatQuota}
                  zeroMeans='unlimited'
                />
                <BucketMeter
                  label={t('Basic model tokens')}
                  total={Number(s?.basic_token_total || 0)}
                  used={Number(s?.basic_token_used || 0)}
                  format={(v) => v.toLocaleString()}
                  zeroMeans='hidden'
                />
              </div>
            </div>
          )
        })
      ) : (
        <div className='bg-card rounded-2xl border p-6 text-center'>
          <p className='text-base font-medium'>{t('No active subscription')}</p>
          <p className='text-muted-foreground mt-1.5 text-sm'>
            {t('Subscribe to a plan to get a dedicated API key and quota.')}
          </p>
        </div>
      )}

      {inactiveSubs.length > 0 && (
        <div className='max-h-40 space-y-2 overflow-y-auto px-1'>
          {inactiveSubs.map((sub) => {
            const s = sub.subscription
            return (
              <div
                key={s?.id}
                className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm'
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    dotColorMap.neutral
                  )}
                  aria-hidden='true'
                />
                <span>{planLabel(s)}</span>
                <span className='text-muted-foreground/40'>·</span>
                <span>
                  {s?.status === 'cancelled' ? t('Cancelled') : t('Expired')}
                </span>
                <span className='text-muted-foreground/40'>·</span>
                <span>
                  {new Date((s?.end_time || 0) * 1000).toLocaleDateString()}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <SubscriptionKeyDialog
        open={keyDialogSub !== null}
        onOpenChange={(open) => {
          if (!open) setKeyDialogSub(null)
        }}
        subscriptionId={keyDialogSub ?? undefined}
        planLabel={
          keyDialogSub !== null
            ? planLabel(
                activeSubs.find((s) => s.subscription?.id === keyDialogSub)
                  ?.subscription,
                keyDialogSub
              )
            : undefined
        }
      />
    </section>
  )
}
