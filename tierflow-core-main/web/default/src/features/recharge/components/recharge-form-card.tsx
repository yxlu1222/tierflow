/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Check, ExternalLink, Gift, Loader2, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatLocalCurrencyAmount } from '@/lib/currency'
import { cn } from '@/lib/utils'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { getDiscountLabel, getPaymentIcon, getMinTopupAmount } from '../lib'
import type { PaymentMethod, PresetAmount, TopupInfo } from '../types'

interface RechargeFormCardProps {
  topupInfo: TopupInfo | null
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  onPaymentMethodSelect: (method: PaymentMethod) => void
  /** Recalculate the payable amount for a newly highlighted method type. */
  onMethodTypeChange?: (type: string) => void
  paymentLoading: string | null
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  topupLink?: string
  loading?: boolean
  priceRatio?: number
  usdExchangeRate?: number
}

/** A bold, black section heading — matches the recharge reference layout. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='text-foreground text-[15px] font-semibold tracking-tight'>
      {children}
    </h3>
  )
}

/** Right-aligned radio indicator for a selectable payment row. */
function RadioDot({ selected }: { selected: boolean }) {
  return selected ? (
    <span className='bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full'>
      <Check className='size-3' strokeWidth={3} />
    </span>
  ) : (
    <span className='border-muted-foreground/30 size-5 shrink-0 rounded-full border-2' />
  )
}

// Unified selection key: 's:<type>' for standard methods.
type Selection = { kind: 'standard'; method: PaymentMethod }

export function RechargeFormCard({
  topupInfo,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  onPaymentMethodSelect,
  onMethodTypeChange,
  paymentLoading,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  topupLink,
  loading,
  priceRatio: _priceRatio = 1,
  usdExchangeRate = 1,
}: RechargeFormCardProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = parseInt(value) || 0
    if (numValue >= 0) {
      onTopupAmountChange(numValue)
    }
  }

  const hasConfigurableTopup = topupInfo?.enable_online_topup
  const minTopup = getMinTopupAmount(topupInfo)
  const redemptionEnabled = topupInfo?.enable_redemption !== false

  const standardMethods = useMemo(
    () => topupInfo?.pay_methods ?? [],
    [topupInfo?.pay_methods]
  )

  // Build the unified, ordered selection list once per data change.
  const selections = useMemo<Selection[]>(() => {
    return standardMethods.map((method) => ({
      kind: 'standard',
      method,
    }))
  }, [standardMethods])

  const keyOf = useCallback((s: Selection) => `s:${s.method.type}`, [])

  const isRowDisabled = useCallback(
    (s: Selection) => {
      const min = s.method.min_topup || 0
      return min > topupAmount
    },
    [topupAmount]
  )

  const selected = useMemo(
    () => selections.find((s) => keyOf(s) === selectedKey) ?? null,
    [selections, selectedKey, keyOf]
  )

  // Auto-select the first available method so "Proceed to Pay" is actionable
  // out of the box (mirrors the reference, where Alipay starts selected).
  useEffect(() => {
    if (selectedKey && selections.some((s) => keyOf(s) === selectedKey)) return
    const first = selections.find((s) => !isRowDisabled(s)) ?? selections[0]
    if (first) setSelectedKey(keyOf(first))
  }, [selections, selectedKey, keyOf, isRowDisabled])

  const handleSelectRow = (s: Selection) => {
    setSelectedKey(keyOf(s))
    onMethodTypeChange?.(s.method.type)
  }

  const handleProceed = () => {
    if (!selected || isRowDisabled(selected)) return
    onPaymentMethodSelect(selected.method)
  }

  const discountRate = topupInfo?.discount?.[topupAmount] ?? 1
  const hasDiscount = discountRate < 1
  // paymentAmount is already discounted; recover the saving exactly.
  const savedAmount = hasDiscount
    ? (paymentAmount * (1 - discountRate)) / discountRate
    : 0

  const proceeding = paymentLoading != null

  if (loading) {
    return (
      <Card className='rounded-2xl shadow-xs ring-0'>
        <CardContent className='space-y-6 p-5 sm:p-6'>
          <div className='space-y-3'>
            <Skeleton className='h-4 w-24' />
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className='h-14 rounded-xl' />
              ))}
            </div>
          </div>
          <div className='space-y-3'>
            <Skeleton className='h-4 w-20' />
            <Skeleton className='h-11 w-full rounded-lg' />
          </div>
          <div className='space-y-3'>
            <Skeleton className='h-4 w-20' />
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className='h-14 w-full rounded-xl' />
            ))}
          </div>
          <Skeleton className='h-12 w-full rounded-xl' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className='rounded-2xl shadow-xs ring-0'>
      <CardContent className='space-y-6 p-5 sm:p-6'>
        {hasConfigurableTopup ? (
          <>
            {/* Preset amounts + custom amount (custom fills the row end) */}
            <section className='space-y-3'>
              <SectionHeading>{t('Select Amount')}</SectionHeading>
              <div className='grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3'>
                {presetAmounts.map((preset, index) => {
                  const discount =
                    preset.discount ||
                    topupInfo?.discount?.[preset.value] ||
                    1.0
                  const displayValue = preset.value * usdExchangeRate
                  const isSelected = selectedPreset === preset.value
                  const label = getDiscountLabel(discount)
                  return (
                    <button
                      key={index}
                      type='button'
                      onClick={() => onSelectPreset(preset)}
                      className={cn(
                        'relative flex h-14 items-center justify-center rounded-xl border text-base font-semibold tabular-nums transition-colors sm:h-16 sm:text-lg',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-muted bg-muted/20 hover:border-foreground/40'
                      )}
                    >
                      {formatLocalCurrencyAmount(displayValue)}
                      {label && (
                        <span
                          className={cn(
                            'absolute top-1.5 right-2 text-[10px] font-medium',
                            isSelected
                              ? 'text-primary-foreground/90'
                              : 'text-emerald-600'
                          )}
                        >
                          {label}
                        </span>
                      )}
                    </button>
                  )
                })}
                {/* Custom amount — dashed border + persistent label so it
                    reads as an input, not another preset tile. */}
                <div className='border-muted-foreground/40 focus-within:border-foreground col-span-2 flex h-14 items-center gap-2.5 rounded-xl border border-dashed px-3.5 transition-colors sm:h-16'>
                  <Pencil className='text-muted-foreground size-4 shrink-0' />
                  <span className='text-muted-foreground shrink-0 text-sm font-medium'>
                    {t('Custom Amount')}
                  </span>
                  <input
                    id='topup-amount'
                    type='number'
                    value={localAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    min={minTopup}
                    placeholder={t('Minimum {{amount}}', { amount: minTopup })}
                    className='w-full min-w-0 flex-1 bg-transparent text-right text-base font-semibold tabular-nums outline-none placeholder:font-normal sm:text-lg'
                  />
                </div>
              </div>
            </section>

            {/* Payment method */}
            <section className='space-y-3'>
              <SectionHeading>{t('Payment Method')}</SectionHeading>
              {selections.length > 0 ? (
                <div className='grid grid-cols-2 gap-2.5'>
                  {selections.map((s) => {
                    const key = keyOf(s)
                    const isSelected = key === selectedKey
                    const disabled = isRowDisabled(s)
                    const name = s.method.name
                    const icon = getPaymentIcon(
                      s.method.type,
                      'size-5',
                      s.method.icon,
                      s.method.name
                    )
                    const min = s.method.min_topup || 0
                    return (
                      <button
                        key={key}
                        type='button'
                        onClick={() => handleSelectRow(s)}
                        disabled={disabled}
                        className={cn(
                          'flex w-full items-center justify-between rounded-xl border px-4 py-3.5 text-left transition-colors',
                          disabled
                            ? 'border-muted cursor-not-allowed opacity-50'
                            : isSelected
                              ? 'border-primary bg-primary/5'
                              : 'border-muted hover:border-foreground/40'
                        )}
                      >
                        <span className='flex min-w-0 items-center gap-3'>
                          <span className='flex size-5 shrink-0 items-center justify-center'>
                            {icon}
                          </span>
                          <span className='truncate text-sm font-medium'>
                            {name}
                          </span>
                          {disabled && (
                            <span className='text-muted-foreground shrink-0 text-xs'>
                              {t('Minimum topup amount: {{amount}}', {
                                amount: min,
                              })}
                            </span>
                          )}
                        </span>
                        <RadioDot selected={isSelected && !disabled} />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <Alert>
                  <AlertDescription>
                    {t(
                      'No payment methods available. Please contact administrator.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </section>

            {/* Summary + proceed */}
            {selections.length > 0 && (
              <div className='space-y-4'>
                <div className='flex items-end justify-between gap-4'>
                  <div className='space-y-1'>
                    <div className='text-foreground text-sm font-medium'>
                      {t('Amount Due')}
                    </div>
                    {hasDiscount && (
                      <div className='text-xs font-medium text-emerald-600'>
                        {t('You save {{amount}}', {
                          amount: formatLocalCurrencyAmount(savedAmount),
                        })}
                      </div>
                    )}
                  </div>
                  <div className='text-right'>
                    {calculating ? (
                      <Skeleton className='h-8 w-24' />
                    ) : (
                      <div className='text-primary text-3xl font-bold tabular-nums'>
                        {formatLocalCurrencyAmount(paymentAmount)}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  onClick={handleProceed}
                  disabled={
                    !selected ||
                    (selected && isRowDisabled(selected)) ||
                    proceeding ||
                    topupAmount < minTopup
                  }
                  className='h-12 w-full rounded-xl text-base font-medium'
                >
                  {proceeding && <Loader2 className='size-4 animate-spin' />}
                  {t('Proceed to Pay')}
                </Button>
              </div>
            )}

            {/* Tips */}
            <div className='space-y-2.5 border-t pt-5'>
              <SectionHeading>{t('Good to know')}</SectionHeading>
              <ul className='text-muted-foreground space-y-1.5 text-sm'>
                {[
                  t('Funds are used to pay for API calls.'),
                  t(
                    'Your balance is credited immediately after a successful payment.'
                  ),
                  t('Contact our support team if you have any questions.'),
                ].map((tip) => (
                  <li key={tip} className='flex gap-2'>
                    <span className='bg-muted-foreground/40 mt-2 size-1 shrink-0 rounded-full' />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <Alert>
            <AlertDescription>
              {t(
                'Online topup is not enabled. Please use redemption code or contact administrator.'
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Redemption Code Section */}
        {redemptionEnabled ? (
          <div className='space-y-3 border-t pt-5'>
            <div className='flex items-center gap-2'>
              <Gift className='text-muted-foreground size-4' />
              <SectionHeading>{t('Have a Code?')}</SectionHeading>
            </div>
            <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2'>
              <Input
                id='redemption-code'
                value={redemptionCode}
                onChange={(e) => onRedemptionCodeChange(e.target.value)}
                placeholder={t('Enter your redemption code')}
                className='h-11 min-w-0'
              />
              <Button
                onClick={onRedeem}
                disabled={redeeming}
                variant='outline'
                className='h-11 px-4'
              >
                {redeeming && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                {t('Redeem')}
              </Button>
            </div>
            {topupLink && (
              <p className='text-muted-foreground text-xs'>
                {t('Need a redemption code?')}{' '}
                <a
                  href={topupLink}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='inline-flex items-center gap-1 underline-offset-4 hover:underline'
                >
                  {t('Get one here')}
                  <ExternalLink className='h-3 w-3' />
                </a>
              </p>
            )}
          </div>
        ) : (
          <Alert className='border-t'>
            <AlertDescription>
              {t(
                'Redemption codes are disabled until the administrator confirms compliance terms.'
              )}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
