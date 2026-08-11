/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { Button } from '@/components/ui/button'
import { CreateTicketDialog } from './create-ticket-dialog'

/**
 * 全局悬浮「问题反馈」入口：普通用户登录后任意页面右下角常驻，点击打开新建工单弹窗。
 * 面向用户自助；管理员从工单管理页处理，不显示此入口。z-40 低于 Dialog 的 z-50。
 */
export function FeedbackFab() {
  const { t } = useTranslation()
  const role = useAuthStore((s) => s.auth.user?.role ?? 0)
  const [open, setOpen] = useState(false)

  if (role >= ROLE.ADMIN) return null

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className='fixed right-6 bottom-6 z-40 h-12 gap-2 rounded-full pr-5 pl-4 shadow-lg'
      >
        <MessageSquarePlus className='size-5' />
        {t('Problem Feedback')}
      </Button>
      <CreateTicketDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
