/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ReactNode } from 'react'
import { Cpu, KeyRound, Network, ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { LanguageSwitcher } from '@/components/language-switcher'
import { HeaderLogo } from '@/components/layout'
import { ApplianceParticleField } from '@/features/dashboard/components/overview/appliance-particle-field'

type AuthLayoutProps = {
  children: ReactNode
}

/**
 * Appliance authentication shell. It deliberately avoids the public website
 * header and footer so the device never exposes marketing or general browsing
 * entry points while the user is signing in.
 */
export function AuthLayout(props: AuthLayoutProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading, logoLoaded } = useSystemConfig()

  const capabilities = [
    { icon: Cpu, label: t('Local-first inference') },
    { icon: KeyRound, label: t('Controlled API key issuance') },
    { icon: Network, label: t('OpenAI-compatible API') },
    { icon: ShieldCheck, label: t('Administrator-managed access') },
  ]

  return (
    <div className='relative flex min-h-svh w-full flex-col overflow-hidden bg-[#f4f7fb] text-slate-950'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(59,130,246,0.14),transparent_28%),radial-gradient(circle_at_92%_18%,rgba(99,102,241,0.13),transparent_30%),linear-gradient(145deg,#f8fbff_0%,#f3f6fb_50%,#eef3fb_100%)]' />
      <div className='pointer-events-none absolute top-0 right-0 h-[58%] w-[58%] [mask-image:linear-gradient(to_bottom_left,black_45%,transparent_92%)] opacity-55'>
        <ApplianceParticleField />
      </div>

      <header className='relative z-10 flex h-20 shrink-0 items-center justify-between px-5 sm:px-8 lg:px-12'>
        <div className='flex items-center gap-3'>
          <div className='flex size-10 items-center justify-center rounded-xl border border-white/80 bg-white/80 shadow-sm backdrop-blur'>
            <HeaderLogo
              src={logo}
              alt={systemName}
              loading={loading}
              logoLoaded={logoLoaded}
              className='size-7 rounded-lg object-contain'
            />
          </div>
          <div>
            <p className='text-[15px] font-semibold tracking-tight'>
              {systemName}
            </p>
            <p className='text-[11px] font-medium tracking-[0.1em] text-blue-600 uppercase'>
              {t('Inference Appliance')}
            </p>
          </div>
        </div>
        <LanguageSwitcher />
      </header>

      <main className='relative z-10 flex flex-1 items-center px-4 pb-8 sm:px-8 lg:px-12'>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className='mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(390px,0.72fr)] lg:items-center lg:gap-14'
        >
          <section className='hidden max-w-2xl pt-2 lg:block lg:pt-0'>
            <span className='inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/72 px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm backdrop-blur'>
              <span className='size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' />
              {t('Dedicated inference system')}
            </span>
            <h1 className='mt-5 max-w-2xl text-[clamp(34px,5vw,62px)] leading-[1.04] font-semibold tracking-[-0.045em] text-slate-950'>
              {t('Welcome to the TierFlow inference appliance')}
            </h1>
            <p className='mt-5 max-w-xl text-[15px] leading-7 text-slate-600 sm:text-base'>
              {t(
                'Sign in to manage models, API keys, routing, and inference activity on this appliance.'
              )}
            </p>

            <div className='mt-7 grid max-w-xl gap-2.5 sm:grid-cols-2'>
              {capabilities.map((capability) => {
                const CapabilityIcon = capability.icon
                return (
                  <div
                    key={capability.label}
                    className='flex items-center gap-3 rounded-xl border border-white/80 bg-white/58 px-3.5 py-3 text-sm font-medium text-slate-700 shadow-[0_8px_28px_rgba(30,64,175,0.04)] backdrop-blur'
                  >
                    <span className='flex size-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600'>
                      <CapabilityIcon className='size-4' />
                    </span>
                    {capability.label}
                  </div>
                )
              })}
            </div>
          </section>

          <section className='mx-auto w-full max-w-[440px] rounded-[24px] border border-white/90 bg-white/88 p-6 shadow-[0_24px_80px_rgba(30,64,175,0.12)] backdrop-blur-xl sm:p-8 lg:max-w-none'>
            <div className='mx-auto w-full max-w-[400px]'>{props.children}</div>
            <div className='mt-7 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-500'>
              <ShieldCheck className='size-3.5 text-emerald-600' />
              {t(
                'Accounts are issued and managed by the appliance administrator.'
              )}
            </div>
          </section>
        </motion.div>
      </main>

      <footer className='relative z-10 flex shrink-0 items-center justify-center px-6 pb-5 text-center text-[11px] text-slate-400'>
        {t('TierFlow dedicated inference environment')}
      </footer>
    </div>
  )
}
