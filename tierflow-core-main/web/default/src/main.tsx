/*
Copyright (C) 2023-2026 TierFlow
*/
import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import i18next from 'i18next'
import { toast } from 'sonner'
import { getStatus } from '@/lib/api'
import { DEFAULT_SYSTEM_NAME } from '@/lib/constants'
import { installBuildMetadata } from '@/lib/build-metadata'
import '@/lib/dayjs'
import { applyFaviconToDom } from '@/lib/dom-utils'
import { initializeFrontendCache } from '@/lib/frontend-cache'
import { handleServerError } from '@/lib/handle-server-error'
import { DirectionProvider } from './context/direction-provider'
import { ThemeProvider } from './context/theme-provider'
import './i18n/config'
// Generated Routes
import { routeTree } from './routeTree.gen'
// Styles
import './styles/index.css'

// Ensure VChart theme is initialized before any chart mounts (prevents white default theme flash)
// VChart theme is driven by our ThemeProvider (html.light/html.dark) via per-chart `theme` prop.
initializeFrontendCache()
installBuildMetadata()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // eslint-disable-next-line no-console
        if (import.meta.env.DEV) console.log({ failureCount, error })

        if (failureCount >= 0 && import.meta.env.DEV) return false
        if (failureCount > 3 && import.meta.env.PROD) return false

        return !(
          error instanceof AxiosError &&
          [401, 403].includes(error.response?.status ?? 0)
        )
      },
      refetchOnWindowFocus: import.meta.env.PROD,
      staleTime: 10 * 1000, // 10s
    },
    mutations: {
      onError: (error) => {
        handleServerError(error)

        if (error instanceof AxiosError) {
          if (error.response?.status === 304) {
            toast.error(i18next.t('Content not modified!'))
          }
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof AxiosError) {
        if (error.response?.status === 500) {
          toast.error(i18next.t('Internal Server Error!'))
          router.navigate({ to: '/500' })
        }
      }
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById('root')!
// Set document.title from the hardcoded brand, and favicon from status logo
;(function initSystemBranding() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    // System name is hardcoded (no longer operator-configurable).
    document.title = DEFAULT_SYSTEM_NAME
    const metaTitle = document.querySelector(
      'meta[name="title"]'
    ) as HTMLMetaElement | null
    if (metaTitle) metaTitle.setAttribute('content', DEFAULT_SYSTEM_NAME)
    // Cache-first favicon
    try {
      const saved = localStorage.getItem('status')
      if (saved) {
        const s = JSON.parse(saved)
        if (s?.logo) applyFaviconToDom(s.logo)
      }
    } catch {
      /* empty */
    }
    // Background refresh (favicon only)
    getStatus()
      .then((s) => {
        try {
          localStorage.setItem('status', JSON.stringify(s))
        } catch {
          /* empty */
        }
        if (s?.logo) applyFaviconToDom(s.logo as string)
      })
      .catch(() => {
        /* empty */
      })
  } catch {
    /* empty */
  }
})()
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <DirectionProvider>
            <RouterProvider router={router} />
          </DirectionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
}
