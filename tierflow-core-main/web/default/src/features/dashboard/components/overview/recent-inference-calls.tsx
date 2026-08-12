/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { formatModelName } from '@/features/usage-logs/lib/format'

type RecentInferenceCallsProps = {
  calls: UsageLog[]
  error: boolean
  isAdmin: boolean
  loading: boolean
  fullLog: React.ReactNode
}

export function RecentInferenceCalls(props: RecentInferenceCallsProps) {
  const { t } = useTranslation()
  const [showFullLog, setShowFullLog] = useState(false)

  return (
    <section className='overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_10px_34px_rgba(15,23,42,0.04)]'>
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4'>
        <div>
          <h2 className='text-[15px] font-semibold text-slate-950'>
            {t('Recent inference calls')}
          </h2>
          <p className='mt-1 text-xs text-slate-500'>
            {t('Latest requests processed by TierFlow')}
          </p>
        </div>
        <Button
          variant='ghost'
          size='sm'
          className='rounded-full'
          onClick={() => setShowFullLog((value) => !value)}
        >
          {showFullLog ? t('Hide full log') : t('View full log')}
          {showFullLog ? (
            <ChevronUp className='size-4' />
          ) : (
            <ChevronDown className='size-4' />
          )}
        </Button>
      </div>

      {props.loading ? (
        <div className='space-y-3 p-5'>
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className='h-10 w-full rounded-lg' />
          ))}
        </div>
      ) : props.error ? (
        <div className='px-5 py-10 text-center text-sm text-slate-500'>
          {t('Failed to load recent inference calls')}
        </div>
      ) : props.calls.length === 0 ? (
        <div className='px-5 py-10 text-center'>
          <p className='text-sm font-medium text-slate-700'>
            {t('No inference calls yet')}
          </p>
          <p className='mt-1 text-xs text-slate-500'>
            {t('Create an API key and send a request to see activity here.')}
          </p>
        </div>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[700px] text-left text-sm'>
            <thead className='bg-slate-50/80 text-xs font-medium text-slate-500'>
              <tr>
                <th className='px-5 py-3'>{t('Model')}</th>
                <th className='px-4 py-3'>{t('Request type')}</th>
                <th className='px-4 py-3'>{t('Input Tokens')}</th>
                <th className='px-4 py-3'>{t('Output Tokens')}</th>
                <th className='px-4 py-3'>{t('Time')}</th>
                <th className='px-5 py-3 text-right'>{t('Status')}</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-slate-100'>
              {props.calls.map((call) => {
                const model = formatModelName(call, props.isAdmin).name
                return (
                  <tr key={call.id} className='hover:bg-slate-50/55'>
                    <td className='px-5 py-3.5 font-medium text-slate-800'>
                      <span className='inline-flex max-w-[240px] truncate rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-700'>
                        {model || t('Unknown model')}
                      </span>
                    </td>
                    <td className='px-4 py-3.5 text-slate-600'>
                      {call.is_stream
                        ? t('Streaming inference')
                        : t('Inference request')}
                    </td>
                    <td className='px-4 py-3.5 font-mono text-slate-600 tabular-nums'>
                      {formatNumber(call.prompt_tokens)}
                    </td>
                    <td className='px-4 py-3.5 font-mono text-slate-600 tabular-nums'>
                      {formatNumber(call.completion_tokens)}
                    </td>
                    <td className='px-4 py-3.5 text-slate-500 tabular-nums'>
                      {dayjs.unix(call.created_at).format('HH:mm:ss')}
                    </td>
                    <td className='px-5 py-3.5 text-right'>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
                          'bg-emerald-50 text-emerald-700'
                        )}
                      >
                        <span className='size-1.5 rounded-full bg-emerald-500' />
                        {t('Success')}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showFullLog && (
        <div className='border-t border-slate-100 bg-slate-50/35 p-3 sm:p-4'>
          {props.fullLog}
        </div>
      )}
    </section>
  )
}
