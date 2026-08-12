/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect } from 'react'
import { type QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import {
  isBillingSettingsPath,
  isCommercialPathDisabled,
} from '@/lib/appliance-mode'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Toaster } from '@/components/ui/sonner'
import { saveAffiliateCode } from '@/features/auth/lib/storage'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'
import { getSetupStatus } from '@/features/setup/api'
import { bootstrapAuthentication } from '@/lib/api'

function RootComponent() {
  // Load system configuration (logo, system name, etc.) from backend
  useSystemConfig({ autoLoad: true })

  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get('aff')?.trim()
    if (aff) {
      saveAffiliateCode(aff)
    }
  }, [])

  return (
    <>
      <Outlet />
      <Toaster duration={5000} position='top-center' />
      {import.meta.env.MODE === 'development' && (
        <>
          <ReactQueryDevtools buttonPosition='bottom-left' />
          <TanStackRouterDevtools position='bottom-right' />
        </>
      )}
    </>
  )
}

// 缓存 setup 状态检查结果，避免每次导航都重复调用 API
// 使用 localStorage 持久化，避免页面刷新后重复检查
const SETUP_CHECKED_KEY = 'setup_status_checked'

function getSetupStatusFromCache(): boolean {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(SETUP_CHECKED_KEY) === 'true'
    }
  } catch {
    /* empty */
  }
  return false
}

function setSetupStatusCache(value: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      if (value) {
        window.localStorage.setItem(SETUP_CHECKED_KEY, 'true')
      } else {
        window.localStorage.removeItem(SETUP_CHECKED_KEY)
      }
    }
  } catch {
    /* empty */
  }
}

// 内存中的标记，避免同一会话中重复检查
let setupStatusChecked = getSetupStatusFromCache()

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  // 应用初始化与路由解析前统一校验会话
  beforeLoad: async ({ location }) => {
    const pathname = location?.pathname || ''

    if (isCommercialPathDisabled(pathname)) {
      throw redirect({ to: '/usage', replace: true })
    }

    if (isBillingSettingsPath(pathname)) {
      throw redirect({
        to: '/system-settings/models/$section',
        params: { section: 'inference' },
        replace: true,
      })
    }

    const needsSetupCheck =
      !setupStatusChecked && !pathname.startsWith('/setup')
    const authBootstrap = bootstrapAuthentication()

    // Setup 检查与认证恢复并行执行，刷新页面时会使用 HttpOnly Cookie
    // 换取新的短期访问令牌，访问令牌本身不会写入 localStorage。
    if (needsSetupCheck) {
      const [status] = await Promise.all([
        getSetupStatus().catch((error) => {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.warn('[root.beforeLoad] setup status check failed', error)
          }
          return null
        }),
        authBootstrap,
      ])

      if (status?.success && status.data && !status.data.status) {
        throw redirect({ to: '/setup' })
      }
      setupStatusChecked = true
      setSetupStatusCache(true)
    } else {
      await authBootstrap
    }
  },
  component: RootComponent,
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
