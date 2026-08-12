/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { DOCS_URL } from '@/lib/constants'
import { useStatus } from '@/hooks/use-status'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

/**
 * Fixed landing-page top navigation links. Visibility used to be admin-
 * configurable via the removed HeaderNavModules setting; all real pages are now
 * always shown. Home/Console are intentionally not nav items (the logo links to
 * home, and the header's "Console" button carries the console entry).
 */
export function useTopNavLinks(): TopNavLink[] {
  const { t } = useTranslation()
  const { status } = useStatus()

  // Documentation link may be an external knowledge base.
  const docsLink: string | undefined = status?.docs_link as string | undefined

  return [
    // 「工作原理」「性能实测」已并入首页(#how / #proof),独立页与导航入口一并撤除
    // 站内没有 /docs 路由,未配置时回落到官方文档站,不要指向内部路径
    { title: t('Docs'), href: docsLink || DOCS_URL, external: true },
    { title: t('About'), href: '/about' },
  ]
}
