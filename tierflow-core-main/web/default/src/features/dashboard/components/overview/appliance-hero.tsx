/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  Check,
  Circle,
  KeyRound,
  Layers3,
  ServerCog,
  Sparkles,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ApplianceParticleField } from './appliance-particle-field'

type ApplianceHeroProps = {
  apiKeyCount: number
  isAdmin: boolean
  modelCount: number
  requestCount: number
  serviceReady: boolean
  loading: boolean
}

type SetupStep = {
  label: string
  complete: boolean
  icon: React.ElementType
}

export function ApplianceHero(props: ApplianceHeroProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const steps: SetupStep[] = [
    {
      label: t('System services ready'),
      complete: props.serviceReady,
      icon: ServerCog,
    },
    {
      label: t('Deploy an inference model'),
      complete: props.modelCount > 0,
      icon: Layers3,
    },
    {
      label: t('Create an API key'),
      complete: props.apiKeyCount > 0,
      icon: KeyRound,
    },
    {
      label: t('Make the first inference call'),
      complete: props.requestCount > 0,
      icon: Sparkles,
    },
  ]

  const readyForCalls = props.serviceReady && props.modelCount > 0

  return (
    <section className='relative isolate overflow-hidden rounded-[24px] border border-blue-100/80 bg-white px-5 py-6 shadow-[0_18px_60px_rgba(30,64,175,0.07)] sm:px-7 sm:py-7 lg:px-9 lg:py-8'>
      <div
        className='pointer-events-none absolute inset-0 -z-20'
        style={{
          background:
            'radial-gradient(circle at 88% 12%, rgba(99,102,241,0.14), transparent 30%), radial-gradient(circle at 68% 86%, rgba(37,99,235,0.09), transparent 36%), linear-gradient(118deg, #ffffff 34%, #f7faff 100%)',
        }}
      />
      <div className='pointer-events-none absolute inset-y-0 right-0 -z-10 w-[62%] [mask-image:linear-gradient(to_left,black_70%,transparent)]'>
        <ApplianceParticleField />
      </div>

      <div className='relative z-10 grid gap-7 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)] lg:items-center'>
        <div>
          <div className='mb-4 flex flex-wrap items-center gap-2'>
            <span className='inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/80 px-3 py-1.5 text-xs font-medium text-blue-700'>
              <span className='relative flex size-2'>
                <span className='absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-55' />
                <span className='relative inline-flex size-2 rounded-full bg-emerald-500' />
              </span>
              {props.loading
                ? t('Checking local services')
                : props.serviceReady
                  ? t('Local services are running')
                  : t('Local service needs attention')}
            </span>
          </div>

          <h1 className='max-w-3xl text-[clamp(30px,4.1vw,52px)] leading-[1.08] font-semibold tracking-[-0.04em] text-slate-950'>
            {t('Welcome to the TierFlow inference appliance')}
          </h1>
          <p className='mt-4 max-w-2xl text-[15px] leading-7 text-slate-600 sm:text-base'>
            {t(
              'Deploy local models, issue API keys, and expose OpenAI-compatible inference services from one workspace.'
            )}
          </p>

          <div className='mt-6 flex flex-wrap gap-3'>
            <Button
              size='lg'
              className='h-11 rounded-full px-5 shadow-[0_8px_24px_rgba(37,99,235,0.22)]'
              onClick={() =>
                void navigate({
                  to:
                    props.isAdmin && props.modelCount === 0
                      ? '/channels'
                      : '/keys',
                })
              }
            >
              {props.isAdmin && props.modelCount === 0
                ? t('Deploy the first model')
                : t('Create API Key')}
              <ArrowRight className='size-4' />
            </Button>
            {props.isAdmin && (
              <Button
                size='lg'
                variant='outline'
                className='h-11 rounded-full bg-white/70 px-5 backdrop-blur-sm'
                onClick={() =>
                  void navigate({
                    to: '/models/$section',
                    params: { section: 'metadata' },
                  })
                }
              >
                {t('Manage model services')}
              </Button>
            )}
          </div>
        </div>

        <div className='rounded-[20px] border border-white/80 bg-white/74 p-4 shadow-[0_18px_46px_rgba(30,64,175,0.08)] backdrop-blur-md sm:p-5'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='text-xs font-semibold tracking-[0.12em] text-blue-600 uppercase'>
                {t('Getting started')}
              </p>
              <h2 className='mt-1.5 text-lg font-semibold text-slate-950'>
                {readyForCalls
                  ? t('Inference service is ready')
                  : t('Complete appliance setup')}
              </h2>
            </div>
            <span className='rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700'>
              {steps.filter((step) => step.complete).length}/{steps.length}
            </span>
          </div>

          <ol className='mt-5 space-y-1.5'>
            {steps.map((step) => {
              const StepIcon = step.icon
              return (
                <li
                  key={step.label}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors',
                    step.complete ? 'bg-blue-50/70' : 'bg-white/60'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border',
                      step.complete
                        ? 'border-blue-200 bg-blue-600 text-white'
                        : 'border-slate-200 bg-white text-slate-400'
                    )}
                  >
                    {step.complete ? (
                      <Check className='size-4' />
                    ) : (
                      <StepIcon className='size-4' />
                    )}
                  </span>
                  <span className='min-w-0 flex-1 text-sm font-medium text-slate-700'>
                    {step.label}
                  </span>
                  {step.complete ? (
                    <span className='text-xs text-blue-600'>{t('Ready')}</span>
                  ) : (
                    <Circle className='size-3 text-slate-300' />
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      </div>
    </section>
  )
}
