/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect } from 'react'
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import i18next from 'i18next'
import { toast } from 'sonner'
import { useAuthStore, type AuthUser } from '@/stores/auth-store'
import { getSelf } from '@/lib/api'
import { wechatLoginByCode } from '@/features/auth/api'
import { saveUserId } from '@/features/auth/lib/storage'

function OAuthComponent() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/(auth)/oauth' }) as {
    redirect?: string
    provider?: 'github' | 'discord' | 'oidc' | 'linuxdo' | 'telegram' | 'wechat'
    code?: string
    state?: string
  }

  useEffect(() => {
    ;(async () => {
      try {
        if (search?.provider === 'wechat' && search.code) {
          // 必须在 getSelf 之前从登录响应里取出并存下 uid:getSelf 会经过
          // axios 拦截器,而拦截器只在 localStorage 存在 uid 时才附加
          // TF-User 头。若等 getSelf 返回后再存,这次请求就已经因缺头被
          // 401 掉,微信登录永远走不通。
          const login = await wechatLoginByCode(search.code)
          const loginUid = (login?.data as { uid?: string } | undefined)?.uid
          if (loginUid) {
            saveUserId(loginUid)
          }
        }
        const res = await getSelf()
        if (res?.success) {
          const user = res.data as AuthUser
          useAuthStore.getState().auth.setUser(user)
          if (user?.uid) {
            saveUserId(user.uid)
          }
          const target = search?.redirect || '/dashboard'
          navigate({ to: target, replace: true })
          return
        }
      } catch {
        /* empty */
      }
      toast.error(i18next.t('OAuth failed'))
      navigate({ to: '/sign-in', replace: true })
    })()
  }, [navigate, search])

  return null
}

export const Route = createFileRoute('/(auth)/oauth')({
  component: OAuthComponent,
})
