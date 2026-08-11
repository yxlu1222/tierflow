/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useCallback } from 'react'
import i18next from 'i18next'
import { toast } from 'sonner'
import { calculateAmount, requestPayment, isApiSuccess } from '../api'
import { submitPaymentForm } from '../lib'

// ============================================================================
// Payment Hook
// ============================================================================

export function usePayment() {
  const [amount, setAmount] = useState<number>(0)
  const [calculating, setCalculating] = useState(false)
  const [processing, setProcessing] = useState(false)

  // Calculate payment amount
  const calculatePaymentAmount = useCallback(
    async (topupAmount: number) => {
      try {
        setCalculating(true)

        const response = await calculateAmount({ amount: topupAmount })

        if (isApiSuccess(response) && response.data) {
          const calculatedAmount = parseFloat(response.data)
          setAmount(calculatedAmount)
          return calculatedAmount
        }

        // Don't show error for calculation, just set to 0
        setAmount(0)
        return 0
      } catch (_error) {
        setAmount(0)
        return 0
      } finally {
        setCalculating(false)
      }
    },
    []
  )

  // Process payment
  const processPayment = useCallback(
    async (topupAmount: number, paymentType: string) => {
      try {
        setProcessing(true)

        const amount = Math.floor(topupAmount)

        const response = await requestPayment({
          amount,
          payment_method: paymentType,
        })

        if (!isApiSuccess(response)) {
          toast.error(response.message || i18next.t('Payment request failed'))
          return false
        }

        if (response.data) {
          const url = (response as unknown as { url?: string }).url
          if (url) {
            submitPaymentForm(url, response.data)
            toast.success(i18next.t('Redirecting to payment page...'))
            return true
          }
        }

        return false
      } catch (_error) {
        toast.error(i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    []
  )

  return {
    amount,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
    setAmount,
  }
}
