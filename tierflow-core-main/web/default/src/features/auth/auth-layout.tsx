/*
Copyright (C) 2023-2026 TierFlow
*/
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { DotMap } from '@/components/ui/dot-map'
import { PublicLayout } from '@/components/layout'

type AuthLayoutProps = {
  children: React.ReactNode
}

/**
 * 所有 auth 页(登录/注册/找回/重置/OTP)的共用外壳。
 * 视觉:浅色渐变上的居中分栏卡片 —— 左侧动态地图 + 系统品牌(桌面端),
 * 右侧承载具体表单(children)。表单逻辑完全由 children 提供,本组件只负责视觉。
 */
export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation()

  return (
    <PublicLayout showMainContainer={false} showNotifications={false}>
      <div className='flex min-h-svh w-full items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4 pt-24 text-[#111827]'>
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className='flex w-full max-w-4xl items-stretch overflow-hidden rounded-2xl bg-white shadow-xl md:min-h-[560px]'
        >
          {/* Left — animated map + brand (desktop only) */}
          <aside className='relative hidden w-1/2 overflow-hidden border-r border-gray-100 md:block'>
            <div className='absolute inset-0 bg-gradient-to-br from-blue-50 to-indigo-100'>
              <DotMap />
              <div className='absolute inset-0 z-10 flex items-center justify-center p-10 text-center'>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.6 }}
                  className='max-w-[22rem] bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-2xl leading-snug font-bold tracking-tight text-balance text-transparent'
                >
                  {t('The token optimization engine for the agent era.')}
                </motion.p>
              </div>
            </div>
          </aside>

          {/* Right — form (children) */}
          <section className='flex w-full flex-col justify-center bg-white p-8 sm:p-10 md:w-1/2'>
            <div className='mx-auto w-full max-w-[400px]'>{children}</div>
          </section>
        </motion.div>
      </div>
    </PublicLayout>
  )
}
