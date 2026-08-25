/*
Copyright (C) 2023-2026 TierFlow
*/
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AnimatedOutlet } from '@/components/page-transition'
import { SkipToMain } from '@/components/skip-to-main'
import { AppHeader } from './app-header'
import { AppSidebar } from './app-sidebar'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout(props: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'

  return (
    <SearchProvider>
      <SidebarProvider defaultOpen={defaultOpen} className='flex-col'>
        <SkipToMain />
        <AppHeader />
        {/* 内容行锁定为视口高度并裁剪溢出,使侧边栏与右侧内容各自拥有独立滚动区域,
            避免侧边栏撑高整页、右侧底部出现大片空白。 */}
        <div className='flex h-[calc(100svh-var(--app-header-height,0px))] min-h-0 w-full overflow-hidden'>
          {/* 固定侧边栏:桌面常驻;移动端隐藏(去掉折叠/弹出按钮后不再占用窄屏) */}
          <div className='hidden shrink-0 md:flex'>
            <AppSidebar />
          </div>
          <SidebarInset
            className={cn(
              '@container/content',
              'h-[calc(100svh-var(--app-header-height,0px))]',
              'min-h-0 overflow-hidden',
              // 内容区(sidebar 右侧)统一浅灰底,配合卡片描边、无阴影
              'bg-[#f6f7fb]',
              'peer-data-[variant=inset]:h-[calc(100svh-var(--app-header-height,0px)-(var(--spacing)*4))]'
            )}
          >
            {props.children ?? <AnimatedOutlet />}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </SearchProvider>
  )
}
