/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getSelf } from '@/lib/api'
import { SectionPageLayout } from '@/components/layout'
import { BillingHero, type BillingUser } from './components/billing-hero'
import { BillingOrders } from './components/billing-orders'

const route = getRouteApi('/_authenticated/billing/')

export function Billing() {
  const { t } = useTranslation()
  const [user, setUser] = useState<BillingUser | null>(null)
  const [loading, setLoading] = useState(true)

  // 支付网关回跳的结果标记(?pay=…):toast 提示一次后清掉参数。
  // pending 必须明确告知「已收款、待人工处理」——转人工的付款若毫无提示,
  // 用户会以为支付没发生,继续用旧 Key 调用然后开始质疑扣款。
  const { pay } = route.useSearch()
  const navigate = route.useNavigate()
  useEffect(() => {
    if (!pay) return
    if (pay === 'success') {
      toast.success(t('Payment successful'))
    } else if (pay === 'fail') {
      toast.error(t('Payment failed, please try again or contact support'))
    } else {
      toast.info(
        t(
          'Payment received. Your order needs manual processing and will be handled soon.'
        ),
        { duration: 10000 }
      )
    }
    void navigate({ search: {}, replace: true })
  }, [pay, t, navigate])

  const fetchUser = useCallback(async () => {
    try {
      setLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as BillingUser)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Bills')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex flex-col gap-4'>
          <BillingHero user={user} loading={loading} />
          <BillingOrders />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
