/*
Copyright (C) 2023-2026 TierFlow
*/
import { Link } from '@tanstack/react-router'
import { Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Skeleton } from '@/components/ui/skeleton'
import { LanguageSwitcher } from '@/components/language-switcher'
import { HeaderLogo } from './header-logo'
import { HeaderUser } from './header-user'

/**
 * Dashboard (console) app header —— 薄顶栏(参考 tierflow-zh ConsoleHeader)。
 *
 * 左:品牌 logo + 名称(→ 首页)。右:tierflow-core 独有的全局控件
 * 搜索 / 语言 / 主题 / 通知 + 账户入口(见 `HeaderUser`,位于通知右侧)。
 * 导航交给固定侧边栏。
 */
export function AppHeader() {
  const { t } = useTranslation()
  const {
    systemName,
    logo: systemLogo,
    loading,
    logoLoaded,
  } = useSystemConfig()

  return (
    <header className='bg-background border-border/50 sticky top-0 z-40 h-[var(--app-header-height,4rem)] w-full shrink-0 border-b'>
      <nav className='flex h-full items-center px-4 md:px-6'>
        {/* Left: 品牌 */}
        <Link to='/usage' className='group flex shrink-0 items-center gap-2.5'>
          <div className='flex size-9 shrink-0 items-center justify-center transition-all duration-300 group-hover:scale-105'>
            {loading ? (
              <Skeleton className='size-full rounded-lg' />
            ) : (
              <HeaderLogo
                src={systemLogo}
                loading={loading}
                logoLoaded={logoLoaded}
                className='size-full rounded-lg object-contain'
              />
            )}
          </div>
          <span className='text-xl font-semibold tracking-tight'>
            {loading ? <Skeleton className='h-4 w-16' /> : systemName}
          </span>
          <span className='hidden items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1.5 text-xs font-medium text-blue-700 md:inline-flex'>
            <Cpu className='size-4' />
            {t('Inference Appliance')}
          </span>
        </Link>

        {/* Spacer */}
        <div className='flex-1' />

        {/* Right: 语言 / 通知 / 账户 */}
        <div className='flex items-center gap-1 sm:gap-2'>
          <LanguageSwitcher />
          <HeaderUser />
        </div>
      </nav>
    </header>
  )
}
