/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'
import { formatQuota, formatTimestampToDate } from '@/lib/format'
import { redeemTopupCode } from '../api'

/** 与后端 common.RedemptionTypeSubscription 对应 */
const REDEMPTION_TYPE_SUBSCRIPTION = 1

// ============================================================================
// Redemption Hook
// ============================================================================

export function useRedemption() {
  const [redeeming, setRedeeming] = useState(false)
  const queryClient = useQueryClient()

  const redeemCode = useCallback(
    async (code: string): Promise<boolean> => {
      if (!code || code.trim() === '') {
        toast.error(i18next.t('Please enter a redemption code'))
        return false
      }

      try {
        setRedeeming(true)
        const response = await redeemTopupCode({ key: code })

        if (response.success && response.data) {
          const result = response.data

          if (result.type === REDEMPTION_TYPE_SUBSCRIPTION) {
            toast.success(
              i18next.t(
                'Subscription activated: {{plan}}, valid until {{date}}',
                {
                  plan: result.plan_title ?? '',
                  date: result.end_time
                    ? formatTimestampToDate(result.end_time)
                    : '',
                }
              ),
              {
                // 开通订阅会自动签发一把套餐专用 Key。不提示的话用户根本不知道
                // 它的存在，也就无从使用刚兑换的套餐。Key 可随时在密钥页取回，
                // 所以这里只做引导，不在 toast 里明文展示。
                description: result.token_key
                  ? i18next.t(
                      'A plan-specific API key has been created. View it on the API Keys page.'
                    )
                  : undefined,
                duration: result.token_key ? 8000 : undefined,
              }
            )
            // 充值页本身是命令式刷新，但仪表盘的套餐卡片与密钥列表走 TanStack
            // Query，不失效的话开通后那两处仍显示旧状态。
            queryClient.invalidateQueries({
              queryKey: ['dashboard', 'self-subscriptions'],
            })
            queryClient.invalidateQueries({ queryKey: ['keys'] })
          } else {
            toast.success(
              i18next.t('Redemption successful! Added: {{quota}}', {
                quota: formatQuota(result.quota),
              })
            )
          }
          return true
        }

        toast.error(response.message || i18next.t('Redemption failed'))
        return false
      } catch (_error) {
        toast.error(i18next.t('Redemption failed'))
        return false
      } finally {
        setRedeeming(false)
      }
    },
    [queryClient]
  )

  return {
    redeeming,
    redeemCode,
  }
}
