/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Check, Copy, Cpu, KeyRound, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type ApplianceServiceCardsProps = {
  apiBaseUrl: string
  apiKeyCount: number
  apiKeysLoading: boolean
  isAdmin: boolean
  modelCount: number
  models: string[]
  modelsLoading: boolean
  requestCount: number
  tokenCount: number
  usageLoading: boolean
}

const cardClass =
  'rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-[0_10px_34px_rgba(15,23,42,0.04)]'

export function ApplianceServiceCards(props: ApplianceServiceCardsProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { copiedText, copyToClipboard } = useCopyToClipboard({ notify: false })

  return (
    <div className='grid gap-4 xl:grid-cols-3'>
      <section className={cardClass}>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600'>
              <Cpu className='size-5.5' />
            </span>
            <div>
              <h2 className='text-lg font-semibold text-slate-950'>
                {t('Model services')}
              </h2>
              <p className='mt-1 text-sm text-slate-500'>
                {t('Models exposed by this appliance')}
              </p>
            </div>
          </div>
          {props.isAdmin && (
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() =>
                void navigate({
                  to: '/model-services',
                })
              }
              aria-label={t('Manage model services')}
            >
              <ArrowUpRight className='size-4' />
            </Button>
          )}
        </div>

        {props.modelsLoading ? (
          <div className='mt-5 space-y-2.5'>
            <Skeleton className='h-7 w-28' />
            <Skeleton className='h-6 w-full' />
            <Skeleton className='h-6 w-4/5' />
          </div>
        ) : (
          <>
            <div className='mt-5 flex items-baseline gap-2'>
              <span className='font-mono text-4xl font-semibold tracking-tight text-blue-600 tabular-nums'>
                {formatNumber(props.modelCount)}
              </span>
              <span className='text-base text-slate-500'>
                {t('models available')}
              </span>
            </div>
            <div className='mt-4 space-y-2'>
              {props.models.slice(0, 3).map((model) => (
                <div key={model} className='flex items-center gap-2 text-sm'>
                  <span className='size-1.5 shrink-0 rounded-full bg-emerald-500' />
                  <span className='min-w-0 flex-1 truncate text-slate-700'>
                    {model}
                  </span>
                  <span className='text-xs text-emerald-600'>
                    {t('Available')}
                  </span>
                </div>
              ))}
              {props.modelCount === 0 && (
                <p className='text-base leading-7 text-slate-500'>
                  {props.isAdmin
                    ? t('No model service is available yet. Contact system maintenance personnel.')
                    : t(
                        'No model is available yet. Contact the appliance administrator.'
                      )}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      <section className={cardClass}>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='flex size-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600'>
              <KeyRound className='size-5.5' />
            </span>
            <div>
              <h2 className='text-lg font-semibold text-slate-950'>
                {t('API access')}
              </h2>
              <p className='mt-1 text-sm text-slate-500'>
                {props.apiKeysLoading
                  ? t('Loading API keys')
                  : t('{{count}} API keys issued', {
                      count: props.apiKeyCount,
                    })}
              </p>
            </div>
          </div>
        </div>

        <div className='mt-5'>
          <p className='text-sm font-medium text-slate-500'>Base URL</p>
          <div className='mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2 pl-3'>
            <code className='min-w-0 flex-1 truncate text-sm text-slate-700'>
              {props.apiBaseUrl}
            </code>
            <Button
              variant='ghost'
              size='icon-sm'
              onClick={() => void copyToClipboard(props.apiBaseUrl)}
              aria-label={t('Copy request URL')}
            >
              {copiedText === props.apiBaseUrl ? (
                <Check className='size-4 text-emerald-600' />
              ) : (
                <Copy className='size-4' />
              )}
            </Button>
          </div>
        </div>

        <div className='mt-4 flex flex-wrap gap-2'>
          <Button
            className='rounded-full'
            onClick={() => void navigate({ to: '/keys' })}
          >
            {t('Create API Key')}
          </Button>
          <Button
            variant='outline'
            className='rounded-full'
            onClick={() => void navigate({ to: '/keys' })}
          >
            {t('Manage keys')}
          </Button>
        </div>
      </section>

      <section className={cardClass}>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='flex size-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700'>
              <Network className='size-5.5' />
            </span>
            <div>
              <h2 className='text-lg font-semibold text-slate-950'>
                {t('Inference activity')}
              </h2>
              <p className='mt-1 text-sm text-slate-500'>
                {t('Last 7 days')}
              </p>
            </div>
          </div>
        </div>

        {props.usageLoading ? (
          <div className='mt-5 grid grid-cols-2 gap-3'>
            <Skeleton className='h-20 rounded-xl' />
            <Skeleton className='h-20 rounded-xl' />
          </div>
        ) : (
          <dl className='mt-5 grid grid-cols-2 gap-3'>
            <div className='rounded-xl bg-slate-50 p-3.5'>
              <dt className='text-sm text-slate-500'>{t('Requests')}</dt>
              <dd className='mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-950 tabular-nums'>
                {formatNumber(props.requestCount)}
              </dd>
            </div>
            <div className='rounded-xl bg-slate-50 p-3.5'>
              <dt className='text-sm text-slate-500'>{t('Tokens')}</dt>
              <dd className='mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-950 tabular-nums'>
                {formatNumber(props.tokenCount)}
              </dd>
            </div>
          </dl>
        )}

        <p className='mt-4 text-base leading-7 text-slate-500'>
          {t(
            'Usage data stays on the appliance and helps operators verify service health.'
          )}
        </p>
      </section>
    </div>
  )
}
