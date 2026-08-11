/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 套餐购买/升级弹窗。视觉与套餐卡片同一套语言(结账单式):
 * 大字应付金额、双额度桶摘要瓦片、收据式升级折算明细;
 * 不用装饰图标,错误用行内文字而非 Alert 框。
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  formatQuota,
  parseQuotaFromDollars,
  quotaUnitsToDollars,
} from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GroupBadge } from '@/components/group-badge'
import { submitPaymentForm } from '@/features/recharge/lib/payment'
import {
  paySubscriptionEpay,
  paySubscriptionBalance,
  paySubscriptionUpgradeEpay,
  getUpgradeQuote,
  upgradeSubscription,
  type SubscriptionUpgradeQuote,
} from '../../api'
import { formatDuration, formatResetPeriod } from '../../lib'
import type { PlanRecord, UserSubscription } from '../../types'

interface PaymentMethod {
  type: string
  name?: string
}

// 支付方式下拉:升级与新购两个分支共用,渲染细节只维护一份
function EpayMethodSelect(props: {
  methods: PaymentMethod[]
  value: string
  label: string
  onValueChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <Select
      items={props.methods.map((m) => ({
        value: m.type,
        label: m.name || m.type,
      }))}
      value={props.value}
      onValueChange={(v) => v !== null && props.onValueChange(v)}
      disabled={props.disabled}
    >
      <SelectTrigger className='flex-1'>
        <SelectValue>{props.label}</SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {props.methods.map((m) => (
            <SelectItem key={m.type} value={m.type}>
              {m.name || m.type}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  /** 升级源订阅(非空即进入升级模式:补差价,不走全价购买) */
  upgradeFrom?: UserSubscription | null
  enableOnlineTopUp?: boolean
  epayMethods?: PaymentMethod[]
  purchaseLimit?: number
  purchaseCount?: number
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

export function SubscriptionPurchaseDialog(props: Props) {
  const { t, i18n } = useTranslation()
  const [paying, setPaying] = useState(false)
  const [selectedEpayMethod, setSelectedEpayMethod] = useState('')
  // 余额购买成功后返回的套餐专用 Key,弹窗内一次性展示
  const [issuedKey, setIssuedKey] = useState('')
  // 升级模式:报价与错误
  const [quote, setQuote] = useState<SubscriptionUpgradeQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')

  const compactNumber = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }),
    [i18n.language]
  )

  useEffect(() => {
    if (props.open && props.epayMethods && props.epayMethods.length > 0) {
      setSelectedEpayMethod(props.epayMethods[0].type)
    } else if (!props.open) {
      setSelectedEpayMethod('')
      setIssuedKey('')
    }
  }, [props.open, props.epayMethods])

  const upgradeMode = !!props.upgradeFrom
  const planIdForQuote = props.plan?.plan?.id ?? 0
  const upgradeFromId = props.upgradeFrom?.id ?? 0
  // 只在异步回调里 setState(避免 effect 内同步 setState);
  // 渲染侧用 target_plan_id 守卫,换套餐后旧报价不串显。
  useEffect(() => {
    if (!props.open || !upgradeFromId || !planIdForQuote) return
    let cancelled = false
    getUpgradeQuote(upgradeFromId, planIdForQuote)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setQuote(res.data)
          setQuoteError('')
        } else {
          setQuote(null)
          setQuoteError(res.message || t('Operation failed'))
        }
      })
      .catch(() => {
        if (cancelled) return
        setQuote(null)
        setQuoteError(t('Operation failed'))
      })
    return () => {
      cancelled = true
    }
  }, [props.open, upgradeFromId, planIdForQuote, t])

  const handleUpgrade = async () => {
    if (!upgradeFromId || !planIdForQuote) return
    setPaying(true)
    try {
      const res = await upgradeSubscription({
        subscription_id: upgradeFromId,
        plan_id: planIdForQuote,
      })
      if (res.success) {
        toast.success(t('Upgrade successful'))
        void props.onPurchaseSuccess?.()
        const key = res.data?.token_key
        if (typeof key === 'string' && key) {
          setIssuedKey(key)
        } else {
          props.onOpenChange(false)
        }
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setPaying(false)
    }
  }

  const handleCopyKey = async () => {
    try {
      await navigator.clipboard.writeText(issuedKey)
      toast.success(t('Copied to clipboard'))
    } catch {
      toast.error(t('Copy failed'))
    }
  }

  const plan = props.plan?.plan
  if (!plan) return null
  // 报价守卫:只认当前套餐的报价(切换套餐时旧报价不串显)
  const activeQuote = quote && quote.target_plan_id === plan.id ? quote : null

  const hasEpay =
    props.enableOnlineTopUp && (props.epayMethods || []).length > 0
  const selectedEpayMethodLabel =
    (props.epayMethods || []).find((m) => m.type === selectedEpayMethod)
      ?.name ||
    selectedEpayMethod ||
    t('Select payment method')
  const totalAmount = Number(plan.total_amount || 0)
  const basicTokenTotal = Number(plan.basic_token_total || 0)
  const priceNumber = Number(plan.price_amount || 0)
  const price = priceNumber.toFixed(2)
  // 高级桶按营销页口径折算成 ¥ 展示
  const advancedCredit =
    Math.round(quotaUnitsToDollars(totalAmount) * 10) / 10
  // price_amount 是人民币,须经汇率折算成 quota(与后端 calcSubscriptionBalanceQuota 一致),
  // 不能直接乘 quotaPerUnit(那是美元口径,会把 ¥9.9 当 $9.9)。
  const balanceCost = Math.max(0, Math.ceil(parseQuotaFromDollars(priceNumber)))
  const userQuota = Math.max(0, Number(props.userQuota || 0))
  const allowBalancePay = plan.allow_balance_pay !== false
  const insufficientBalance = userQuota < balanceCost
  const limitReached =
    (props.purchaseLimit || 0) > 0 &&
    (props.purchaseCount || 0) >= (props.purchaseLimit || 0)
  const resetPeriod = formatResetPeriod(plan, t)
  const hasReset = resetPeriod !== t('No Reset')

  // epay 下单→跳转网关的共用壳:新购与升级差价只差调用哪个 API,
  // 成功/失败/toast/finally 的行为必须保持一致,分开写迟早漂移
  const launchEpay = async (
    request: () => Promise<{
      message?: string
      data?: Record<string, unknown>
      url?: string
    }>
  ) => {
    if (!selectedEpayMethod) {
      toast.error(t('Please select a payment method'))
      return
    }
    setPaying(true)
    try {
      const res = await request()
      if (res.message === 'success' && res.url) {
        submitPaymentForm(res.url, res.data || {})
        toast.success(t('Payment initiated'))
        props.onOpenChange(false)
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  const handlePayEpay = () =>
    launchEpay(() =>
      paySubscriptionEpay({
        plan_id: plan.id,
        payment_method: selectedEpayMethod,
      })
    )

  // 在线支付升级差价:下单后跳转支付网关,升级本身由支付回调完成
  const handleUpgradeEpay = () => {
    if (!upgradeFromId) return
    return launchEpay(() =>
      paySubscriptionUpgradeEpay({
        subscription_id: upgradeFromId,
        plan_id: plan.id,
        payment_method: selectedEpayMethod,
      })
    )
  }

  const handlePayBalance = async () => {
    if (!allowBalancePay) {
      toast.error(t('This plan does not allow balance redemption'))
      return
    }
    setPaying(true)
    try {
      const res = await paySubscriptionBalance({ plan_id: plan.id })
      if (res.success) {
        toast.success(t('Subscription purchased successfully'))
        void props.onPurchaseSuccess?.()
        const key = res.data?.token_key
        if (typeof key === 'string' && key) {
          // 展示专用 Key,由用户手动关闭
          setIssuedKey(key)
        } else {
          props.onOpenChange(false)
        }
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  // 购买成功后的 Key 展示态:整个弹窗切换为一次性 Key 提示
  if (issuedKey) {
    return (
      <Dialog open={props.open} onOpenChange={props.onOpenChange}>
        <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {t('Subscription purchased successfully')}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <p className='text-muted-foreground text-sm leading-relaxed'>
              {t(
                'This is your dedicated plan API key. It is bound to this subscription and billed against its quota only.'
              )}
            </p>
            <div className='bg-muted/50 rounded-xl border p-3.5'>
              <code className='text-xs break-all'>{issuedKey}</code>
            </div>
            <div className='flex gap-2'>
              <Button className='flex-1' onClick={handleCopyKey}>
                {t('Copy Key')}
              </Button>
              <Button
                variant='ghost'
                className='flex-1'
                onClick={() => props.onOpenChange(false)}
              >
                {t('Close')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {upgradeMode ? t('Upgrade') : t('Purchase Subscription')}
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-5'>
          {/* 套餐概要:名称 + 大字金额(升级模式 = 应付差价) */}
          <div>
            <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
              <span className='text-sm font-medium'>{plan.title}</span>
              {plan.subtitle && (
                <span className='text-muted-foreground text-xs'>
                  {plan.subtitle}
                </span>
              )}
            </div>
            <div className='mt-2 flex items-baseline gap-1.5'>
              <span className='text-3xl font-semibold tracking-tight tabular-nums'>
                ¥
                {upgradeMode && activeQuote
                  ? activeQuote.amount_due.toFixed(2)
                  : price}
              </span>
              <span className='text-muted-foreground text-xs'>
                {upgradeMode
                  ? t('Amount Due')
                  : `/ ${formatDuration(plan, t)}`}
              </span>
            </div>
          </div>

          {/* 双额度桶摘要 */}
          <div className='grid grid-cols-2 gap-2'>
            <div className='bg-muted/50 rounded-xl px-3.5 py-2.5'>
              <div className='text-muted-foreground text-[11px]'>
                {t('Premium model credit')}
              </div>
              <div className='mt-0.5 text-sm font-semibold tabular-nums'>
                {totalAmount > 0 ? `¥${advancedCredit}` : t('Unlimited')}
              </div>
            </div>
            <div className='bg-muted/50 rounded-xl px-3.5 py-2.5'>
              <div className='text-muted-foreground text-[11px]'>
                {t('Basic model tokens')}
              </div>
              <div className='mt-0.5 text-sm font-semibold tabular-nums'>
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

          {/* 条款明细 */}
          <div className='space-y-1.5'>
            <div className='flex items-center justify-between text-xs'>
              <span className='text-muted-foreground'>
                {t('Validity Period')}
              </span>
              <span>{formatDuration(plan, t)}</span>
            </div>
            {hasReset && (
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>
                  {t('Reset Period')}
                </span>
                <span>{resetPeriod}</span>
              </div>
            )}
            {plan.upgrade_group && (
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>
                  {t('Upgrade Group')}
                </span>
                <GroupBadge group={plan.upgrade_group} />
              </div>
            )}
          </div>

          {/* 升级折算明细(收据式):套餐价格 − 剩余价值 = 顶部大字应付 */}
          {upgradeMode && activeQuote && (
            <div className='space-y-1.5 border-t pt-3'>
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>{t('Plan price')}</span>
                <span className='tabular-nums'>¥{price}</span>
              </div>
              <div className='flex items-center justify-between text-xs'>
                <span className='text-muted-foreground'>
                  {t('Remaining value credit')} (
                  {t('{{count}} days remaining', {
                    count: activeQuote.remaining_days,
                  })}
                  )
                </span>
                <span className='tabular-nums'>
                  -¥{activeQuote.remaining_value.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {upgradeMode && quoteError && (
            <p className='text-destructive text-xs'>{quoteError}</p>
          )}

          {!upgradeMode && limitReached && (
            <p className='text-destructive text-xs'>
              {t('Purchase limit reached')} ({props.purchaseCount}/
              {props.purchaseLimit})
            </p>
          )}

          {/* 支付操作 */}
          {upgradeMode ? (
            <div className='space-y-2.5'>
              {/* 差价 > 0 时提供在线支付通道;0 元差价只能走余额(免支付直升) */}
              {hasEpay && !!activeQuote && activeQuote.amount_due >= 0.01 && (
                <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
                  <EpayMethodSelect
                    methods={props.epayMethods || []}
                    value={selectedEpayMethod}
                    label={selectedEpayMethodLabel}
                    onValueChange={setSelectedEpayMethod}
                    disabled={paying}
                  />
                  <Button
                    onClick={handleUpgradeEpay}
                    disabled={paying || !selectedEpayMethod || !!quoteError}
                  >
                    {t('Pay difference online')}
                  </Button>
                </div>
              )}
              <Button
                variant={
                  hasEpay && !!activeQuote && activeQuote.amount_due >= 0.01
                    ? 'outline'
                    : 'default'
                }
                onClick={handleUpgrade}
                disabled={paying || !activeQuote || !!quoteError}
                className='w-full'
              >
                {t('Upgrade with balance')}
                {activeQuote ? ` (¥${activeQuote.amount_due.toFixed(2)})` : ''}
              </Button>
            </div>
          ) : (
            <div className='space-y-2.5'>
              {hasEpay && (
                <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
                  <EpayMethodSelect
                    methods={props.epayMethods || []}
                    value={selectedEpayMethod}
                    label={selectedEpayMethodLabel}
                    onValueChange={setSelectedEpayMethod}
                    disabled={limitReached}
                  />
                  <Button
                    onClick={handlePayEpay}
                    disabled={paying || !selectedEpayMethod || limitReached}
                  >
                    {t('Pay')}
                  </Button>
                </div>
              )}

              <Button
                variant={hasEpay ? 'outline' : 'default'}
                className='w-full'
                onClick={handlePayBalance}
                disabled={
                  paying ||
                  limitReached ||
                  !allowBalancePay ||
                  insufficientBalance
                }
              >
                {t('Pay with Balance')}
              </Button>

              <p className='text-muted-foreground text-center text-xs tabular-nums'>
                {t('Balance')}: {formatQuota(userQuota)} · {t('Required')}:{' '}
                {formatQuota(balanceCost)}
                {!allowBalancePay ? (
                  <span className='text-destructive'>
                    {' '}
                    · {t('This plan does not allow balance redemption')}
                  </span>
                ) : (
                  insufficientBalance && (
                    <span className='text-destructive'>
                      {' '}
                      · {t('Insufficient balance')}
                    </span>
                  )
                )}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
