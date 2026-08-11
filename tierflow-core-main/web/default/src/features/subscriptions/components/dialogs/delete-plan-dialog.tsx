/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { deletePlan } from '../../api'
import { useSubscriptions } from '../subscriptions-provider'

/**
 * 删除套餐。后端只拦「还在用」的引用:未到期的用户订阅、支付中的订单;订阅到期
 * 后即可删除。被拒时返回带条数的说明,由全局响应拦截器 toast 出来 —— 此处不再
 * 重复报错,并且保持弹窗打开,让管理员读完原因后自行取消。
 */
export function DeletePlanDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useSubscriptions()
  const [loading, setLoading] = useState(false)

  if (open !== 'delete' || !currentRow) return null

  const handleConfirm = async () => {
    setLoading(true)
    try {
      const res = await deletePlan(currentRow.plan.id)
      if (res.success) {
        toast.success(t('Plan deleted'))
        triggerRefresh()
        setOpen(null)
      }
    } catch {
      /* 失败原因已由全局拦截器提示 */
    } finally {
      setLoading(false)
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(v) => !v && setOpen(null)}
      title={t('Delete plan')}
      desc={t(
        'Plan "{{title}}" will be permanently deleted. Deletion is rejected while any user subscription is still valid or a payment is in progress; disable the plan first and delete it once every subscription has expired.',
        { title: currentRow.plan.title }
      )}
      handleConfirm={handleConfirm}
      isLoading={loading}
      confirmText={t('Delete')}
      destructive
    />
  )
}
