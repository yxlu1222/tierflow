/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import { LogOut, User, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatQuota } from '@/lib/format'
import useDialogState from '@/hooks/use-dialog'
import { useUserDisplay } from '@/hooks/use-user-display'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { useProfile } from '@/features/profile/hooks/use-profile'

/**
 * 顶栏右侧「账户」入口(原侧边栏顶部资料卡迁移而来)。
 * 紧凑的圆形头像按钮,悬停即向下弹出「仪表盘」账户卡:
 * 身份(头像 / 名称 / 角色 / 分组)+ 余额 / 已用 / 请求三枚统计 tile
 * (与个人资料、账单页 hero 同一套 tile 语言)+ 个人资料 / 账单 / 登出。
 * 余额等实时数据来自 useProfile(),在顶栏挂载时拉取一次并保持。
 */
export function HeaderUser() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [signOutOpen, setSignOutOpen] = useDialogState()
  const user = useAuthStore((state) => state.auth.user)
  const { displayName, secondaryText, roleLabel } = useUserDisplay(user)
  const { profile, loading } = useProfile()

  const avatarName = user?.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = getUserAvatarStyle(avatarName)

  const group = profile?.group || user?.group
  const identifiers = [
    secondaryText && secondaryText !== displayName ? secondaryText : null,
    group ? String(group) : null,
  ].filter(Boolean)
  const subline = identifiers.join(' · ')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        openOnHover
        delay={100}
        closeDelay={150}
        className='flex size-9 shrink-0 items-center justify-center rounded-full transition-colors outline-none hover:bg-black/5 data-[state=open]:bg-black/5'
        aria-label={t('Account')}
      >
        <span
          className='border-border flex size-7 items-center justify-center rounded-full border text-[12px] font-semibold shadow-sm'
          style={avatarFallbackStyle}
        >
          {avatarFallback}
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side='bottom'
        align='end'
        sideOffset={6}
        className='w-60 p-1.5'
      >
        {/* 身份:头像 + 名称 + 角色 + 邮箱·分组,右侧余额 */}
        <div className='flex items-center gap-2.5 px-1.5 py-1.5'>
          <span
            className='border-border flex size-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold shadow-sm'
            style={avatarFallbackStyle}
          >
            {avatarFallback}
          </span>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-1.5'>
              <span className='text-foreground truncate text-[13px] font-semibold'>
                {displayName}
              </span>
              {roleLabel && (
                <span className='bg-primary/10 text-primary shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold'>
                  {roleLabel}
                </span>
              )}
            </div>
            {subline && (
              <div className='text-muted-foreground mt-0.5 truncate text-xs'>
                {subline}
              </div>
            )}
          </div>
          <div className='shrink-0 pl-2 text-right'>
            <div className='text-muted-foreground text-[10px] font-medium tracking-wider uppercase'>
              {t('Balance')}
            </div>
            {loading || !profile ? (
              <Skeleton className='mt-1 ml-auto h-5 w-14' />
            ) : (
              <div className='text-primary font-mono text-base font-semibold tracking-tight tabular-nums'>
                {formatQuota(profile.quota)}
              </div>
            )}
          </div>
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: '/profile' })}>
          <User className='size-4' />
          {t('Profile')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate({ to: '/billing' })}>
          <Wallet className='size-4' />
          {t('Bills')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          variant='destructive'
          onClick={() => setSignOutOpen(true)}
        >
          <LogOut className='size-4' />
          {t('Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>

      <SignOutDialog open={!!signOutOpen} onOpenChange={setSignOutOpen} />
    </DropdownMenu>
  )
}
