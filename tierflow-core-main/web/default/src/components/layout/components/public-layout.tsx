/*
Copyright (C) 2023-2026 TierFlow
*/
import type { TopNavLink } from '../types'
import { Footer } from './footer'
import { PublicHeader, type PublicHeaderProps } from './public-header'

type PublicLayoutProps = {
  children: React.ReactNode
  showMainContainer?: boolean
  /** 是否显示页脚。默认显示;落地页等自带页脚的页面可传 false。 */
  showFooter?: boolean
  navContent?: React.ReactNode
  headerProps?: Omit<PublicHeaderProps, 'navContent'>
  navLinks?: TopNavLink[]
  showAuthButtons?: boolean
  showNotifications?: boolean
  logo?: React.ReactNode
  siteName?: string
}

export function PublicLayout(props: PublicLayoutProps) {
  return (
    <div className='bg-background text-foreground relative flex min-h-svh flex-col overflow-x-clip'>
      <PublicHeader
        navContent={props.navContent}
        navLinks={props.navLinks}
        showAuthButtons={props.showAuthButtons}
        showNotifications={props.showNotifications}
        logo={props.logo}
        siteName={props.siteName}
        {...props.headerProps}
      />

      {props.showMainContainer !== false ? (
        <main className='container flex-1 px-4 py-6 pt-24 md:px-4'>
          {props.children}
        </main>
      ) : (
        props.children
      )}

      {props.showFooter !== false && <Footer />}
    </div>
  )
}
