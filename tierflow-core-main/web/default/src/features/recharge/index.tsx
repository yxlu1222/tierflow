/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getSelf } from '@/lib/api'
import { useStatus } from '@/hooks/use-status'
import { useSystemConfig } from '@/hooks/use-system-config'
import { SectionPageLayout } from '@/components/layout'
import { AffiliateRewardsCard } from './components/affiliate-rewards-card'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { TransferDialog } from './components/dialogs/transfer-dialog'
import { RechargeFormCard } from './components/recharge-form-card'
import { RechargeHero } from './components/recharge-hero'
import { DEFAULT_DISCOUNT_RATE } from './constants'
import { useTopupInfo, usePayment, useAffiliate, useRedemption } from './hooks'
import { getMinTopupAmount } from './lib'
import type { UserWalletData, PaymentMethod, PresetAmount } from './types'

export function Recharge() {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')

  const { status } = useStatus()
  const { currency } = useSystemConfig()
  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()

  // Calculate effective exchange rate - when display type is USD, use rate of 1
  const effectiveUsdExchangeRate = useMemo(() => {
    return currency?.quotaDisplayType === 'USD'
      ? 1
      : currency?.usdExchangeRate || 1
  }, [currency?.quotaDisplayType, currency?.usdExchangeRate])
  const {
    amount: paymentAmount,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
  } = usePayment()
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const { redeeming, redeemCode } = useRedemption()

  // Fetch and refresh user data
  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Initialize topup amount when topup info is loaded
  useEffect(() => {
    if (topupInfo && topupAmount === 0) {
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)

      // Calculate initial payment amount
      calculatePaymentAmount(minTopup)
    }
  }, [topupInfo, topupAmount, calculatePaymentAmount])

  // Handle preset selection
  const handleSelectPreset = (preset: PresetAmount) => {
    setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    calculatePaymentAmount(preset.value)
  }

  // Handle topup amount change
  const handleTopupAmountChange = (amount: number) => {
    setTopupAmount(amount)
    setSelectedPreset(null)
    calculatePaymentAmount(amount)
  }

  // Recalculate the payable amount when the highlighted method changes, so the
  // summary reflects the selected gateway before the user proceeds to pay.
  const handleMethodTypeChange = () => {
    calculatePaymentAmount(topupAmount)
  }

  // Handle payment method selection
  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    setSelectedPaymentMethod(method)
    setPaymentLoading(method.type)

    try {
      // Validate minimum topup
      const minTopup = getMinTopupAmount(topupInfo)
      if (topupAmount < minTopup) {
        return
      }

      // Calculate payment amount and show confirmation dialog
      await calculatePaymentAmount(topupAmount)
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  // Handle payment confirmation
  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    const success = await processPayment(
      topupAmount,
      selectedPaymentMethod.type
    )

    if (success) {
      setConfirmDialogOpen(false)
      await fetchUser()
    }
  }

  // Handle redemption
  const handleRedeem = async () => {
    if (!redemptionCode) return

    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      await fetchUser()
    }
  }

  // Handle transfer
  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) {
      await fetchUser()
    }
    return success
  }

  // Get discount rate for current topup amount
  const getDiscountRate = useCallback(() => {
    return topupInfo?.discount?.[topupAmount] || DEFAULT_DISCOUNT_RATE
  }, [topupInfo, topupAmount])

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Recharge')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='flex flex-col gap-4'>
            <RechargeHero user={user} loading={userLoading} />

            <div id='wallet-add-funds' className='scroll-mt-4'>
              <RechargeFormCard
                topupInfo={topupInfo}
                presetAmounts={presetAmounts}
                selectedPreset={selectedPreset}
                onSelectPreset={handleSelectPreset}
                topupAmount={topupAmount}
                onTopupAmountChange={handleTopupAmountChange}
                paymentAmount={paymentAmount}
                calculating={calculating}
                onPaymentMethodSelect={handlePaymentMethodSelect}
                onMethodTypeChange={handleMethodTypeChange}
                paymentLoading={paymentLoading}
                redemptionCode={redemptionCode}
                onRedemptionCodeChange={setRedemptionCode}
                onRedeem={handleRedeem}
                redeeming={redeeming}
                topupLink={topupInfo?.topup_link}
                loading={topupLoading}
                priceRatio={(status?.price as number) || 1}
                usdExchangeRate={effectiveUsdExchangeRate}
              />
            </div>

            {topupInfo?.enable_invitation_reward !== false && (
              <AffiliateRewardsCard
                user={user}
                affiliateLink={affiliateLink}
                onTransfer={() => setTransferDialogOpen(true)}
                complianceConfirmed={
                  topupInfo?.payment_compliance_confirmed !== false
                }
                loading={affiliateLoading}
              />
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={topupAmount}
        paymentAmount={paymentAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={processing}
        discountRate={getDiscountRate()}
        usdExchangeRate={effectiveUsdExchangeRate}
      />

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />
    </>
  )
}
