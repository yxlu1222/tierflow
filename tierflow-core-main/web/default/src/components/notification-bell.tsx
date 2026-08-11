/*
Copyright (C) 2023-2026 TierFlow
*/
import { Link, type LinkProps } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface NotificationBellProps {
  /** Destination route for the notification center. */
  to: LinkProps['to']
  /** Optional router search params (e.g. sign-in redirect). */
  search?: LinkProps['search']
  /** Unread announcement count; hides the badge when 0. */
  unreadCount: number
  /** Called after the link is clicked (e.g. close a mobile drawer). */
  onNavigate?: () => void
  className?: string
}

/**
 * 顶栏通知铃铛 —— 点击直接跳转到通知中心(不再弹出卡片)。
 * 视觉沿用原 NotificationPopover 触发器:ghost icon 按钮 + 未读角标。
 */
export function NotificationBell({
  to,
  search,
  unreadCount,
  onNavigate,
  className,
}: NotificationBellProps) {
  const { t } = useTranslation()

  return (
    <Button
      variant='ghost'
      size='icon'
      className={cn('relative size-9', className)}
      aria-label={t('Notifications')}
      render={<Link to={to} search={search} onClick={onNavigate} />}
    >
      <Bell className='size-[1.2rem]' />
      {unreadCount > 0 ? (
        <Badge
          variant='destructive'
          className='absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold tabular-nums'
        >
          {unreadCount > 99 ? '99+' : unreadCount}
        </Badge>
      ) : null}
    </Button>
  )
}
