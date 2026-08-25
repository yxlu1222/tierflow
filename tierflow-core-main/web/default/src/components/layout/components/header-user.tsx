/*
Copyright (C) 2023-2026 TierFlow
*/
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth-store'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import useDialogState from '@/hooks/use-dialog'
import { useUserDisplay } from '@/hooks/use-user-display'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SignOutDialog } from '@/components/sign-out-dialog'

/** 一体机顶栏的紧凑账户入口，仅保留身份、个人资料与退出操作。 */
export function HeaderUser() {
  const { t } = useTranslation()
  const [signOutOpen, setSignOutOpen] = useDialogState()
  const user = useAuthStore((state) => state.auth.user)
  const { displayName, secondaryText, roleLabel } = useUserDisplay(user)

  const avatarName = user?.username || displayName
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarFallbackStyle = getUserAvatarStyle(avatarName)

  const group = user?.group
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
        {/* 身份：头像 + 名称 + 角色 + 邮箱/分组。 */}
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
        </div>

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
