/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  Boxes,
  CircleOff,
  Clock3,
  Gauge,
  GitBranch,
  LockKeyhole,
  RefreshCw,
  Server,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatNumber } from '@/lib/format'
import { getApplianceModelServices } from './api'
import type {
  ApplianceModelInstance,
  ApplianceModelService,
  ApplianceModelServicesData,
} from './types'

const POLL_INTERVAL_MS = 5000

const stateClasses = {
  running: 'bg-emerald-50 text-emerald-700',
  degraded: 'bg-amber-50 text-amber-700',
  stopped: 'bg-rose-50 text-rose-700',
  unavailable: 'bg-rose-50 text-rose-700',
  unconfigured: 'bg-slate-100 text-slate-600',
}

function stateLabel(state: string, t: (key: string) => string): string {
  switch (state) {
    case 'running':
      return t('Running')
    case 'degraded':
      return t('Degraded')
    case 'stopped':
      return t('Stopped')
    case 'unavailable':
      return t('Unavailable')
    default:
      return t('Not configured')
  }
}

function ScopeBadge(props: { scope: ApplianceModelService['deployment_scope'] }) {
  const { t } = useTranslation()
  const labels = {
    local: t('Local model'),
    external: t('External service'),
    mixed: t('Mixed deployment'),
    unconfigured: t('Not deployed'),
  }
  return <Badge variant='outline'>{labels[props.scope]}</Badge>
}

function InstanceRow(props: { instance: ApplianceModelInstance }) {
  const { t } = useTranslation()
  return (
    <div className='grid gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center'>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='truncate text-base font-medium text-slate-800'>
            {props.instance.name}
          </p>
          <Badge variant='outline'>{props.instance.runtime}</Badge>
          {props.instance.local && (
            <Badge className='bg-blue-50 text-blue-700'>{t('Local')}</Badge>
          )}
        </div>
        <p className='mt-1 truncate font-mono text-sm text-slate-500'>
          {props.instance.endpoint || '—'}
        </p>
      </div>
      <span className='text-sm text-slate-500'>
        {props.instance.response_time_ms > 0
          ? `${props.instance.response_time_ms} ms`
          : t('No latency sample')}
      </span>
      <Badge className={stateClasses[props.instance.state]}>
        {stateLabel(props.instance.state, t)}
      </Badge>
    </div>
  )
}

function ModelServiceCard(props: { service: ApplianceModelService }) {
  const { t } = useTranslation()
  return (
    <Card className='gap-3'>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <CardTitle className='font-mono text-xl'>{props.service.name}</CardTitle>
              <Badge className={stateClasses[props.service.state]}>
                {stateLabel(props.service.state, t)}
              </Badge>
              <ScopeBadge scope={props.service.deployment_scope} />
            </div>
            {props.service.description && (
              <p className='mt-1.5 text-base text-slate-500'>
                {props.service.description}
              </p>
            )}
          </div>
          <span className='text-sm text-slate-500'>
            {t('{{available}} / {{total}} instances available', {
              available: props.service.available_instances,
              total: props.service.total_instances,
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <dl className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <div className='rounded-xl bg-slate-50 p-3.5'>
            <dt className='flex items-center gap-2 text-sm text-slate-500'>
              <Activity className='size-3.5' />
              {t('Requests (24h)')}
            </dt>
            <dd className='mt-2 font-mono text-2xl font-semibold text-slate-950'>
              {formatNumber(props.service.request_count_24h)}
            </dd>
          </div>
          <div className='rounded-xl bg-slate-50 p-3.5'>
            <dt className='flex items-center gap-2 text-sm text-slate-500'>
              <Gauge className='size-3.5' />
              {t('Success Rate')}
            </dt>
            <dd className='mt-2 font-mono text-2xl font-semibold text-slate-950'>
              {props.service.request_count_24h > 0
                ? `${props.service.success_rate_24h.toFixed(1)}%`
                : '—'}
            </dd>
          </div>
          <div className='rounded-xl bg-slate-50 p-3.5'>
            <dt className='flex items-center gap-2 text-sm text-slate-500'>
              <Clock3 className='size-3.5' />
              {t('Average latency')}
            </dt>
            <dd className='mt-2 font-mono text-2xl font-semibold text-slate-950'>
              {props.service.request_count_24h > 0
                ? `${props.service.avg_latency_ms_24h} ms`
                : '—'}
            </dd>
          </div>
          <div className='rounded-xl bg-slate-50 p-3.5'>
            <dt className='flex items-center gap-2 text-sm text-slate-500'>
              <Server className='size-3.5' />
              {t('Throughput (tok/s)')}
            </dt>
            <dd className='mt-2 font-mono text-2xl font-semibold text-slate-950'>
              {props.service.request_count_24h > 0
                ? props.service.avg_tps_24h.toFixed(1)
                : '—'}
            </dd>
          </div>
        </dl>

        <div className='mt-4 space-y-2'>
          {props.service.instances.length > 0 ? (
            props.service.instances.map((instance) => (
              <InstanceRow key={instance.id} instance={instance} />
            ))
          ) : (
            <div className='rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500'>
              {t(
                'This model has metadata but no inference runtime is attached yet.'
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function RoutingPolicyCard(props: {
  policy: ApplianceModelServicesData['routing_policy']
}) {
  const { t } = useTranslation()
  const items = [
    {
      label: t('Failure threshold'),
      value: t('{{count}} consecutive failures', {
        count: props.policy.failure_threshold,
      }),
    },
    {
      label: t('Decision window'),
      value: t('{{count}} seconds', { count: props.policy.window_seconds }),
    },
    {
      label: t('Recovery cooldown'),
      value: t('{{base}}–{{max}} seconds', {
        base: props.policy.cooldown_seconds,
        max: props.policy.max_cooldown_seconds,
      }),
    },
    {
      label: t('Retry budget'),
      value: t('Up to {{count}} attempts per request', {
        count: props.policy.max_total_attempts_per_route,
      }),
    },
  ]

  return (
    <Card className='overflow-hidden border-blue-100 bg-[linear-gradient(120deg,#ffffff_30%,#f4f7ff_100%)]'>
      <CardContent className='grid gap-6 p-6 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.4fr)] xl:items-center'>
        <div>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='flex size-11 items-center justify-center rounded-2xl bg-blue-600 text-white'>
              <GitBranch className='size-5.5' />
            </span>
            <Badge className='bg-blue-50 text-blue-700'>
              <LockKeyhole className='size-3.5' />
              {t('Appliance managed')}
            </Badge>
          </div>
          <h3 className='mt-4 text-xl font-semibold text-slate-950'>
            {t('Built-in routing policy')}
          </h3>
          <p className='mt-2 text-base leading-7 text-slate-600'>
            {t(
              'Model selection, failover order, and safety thresholds are preset by the appliance. Users can monitor outcomes without changing routing behavior.'
            )}
          </p>
        </div>

        <dl className='grid gap-3 sm:grid-cols-2'>
          {items.map((item) => (
            <div
              key={item.label}
              className='rounded-2xl border border-white/80 bg-white/85 p-4 shadow-[0_8px_26px_rgba(37,99,235,0.05)]'
            >
              <dt className='text-sm text-slate-500'>{item.label}</dt>
              <dd className='mt-1.5 text-base font-semibold text-slate-900'>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function ModelServices() {
  const { t } = useTranslation()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const query = useQuery({
    queryKey: ['appliance', 'model-services', 24],
    queryFn: () => getApplianceModelServices(24),
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  })
  const data = query.data?.data

  const summaryCards = data
    ? [
        {
          label: t('Model services'),
          value: data.summary.total,
          icon: Boxes,
          color: 'text-blue-600 bg-blue-50',
        },
        {
          label: t('Running'),
          value: data.summary.running,
          icon: Activity,
          color: 'text-emerald-600 bg-emerald-50',
        },
        {
          label: t('Degraded'),
          value: data.summary.degraded,
          icon: TriangleAlert,
          color: 'text-amber-700 bg-amber-50',
        },
        {
          label: t('Stopped / not configured'),
          value: data.summary.stopped + data.summary.unconfigured,
          icon: CircleOff,
          color: 'text-slate-600 bg-slate-100',
        },
      ]
    : []

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Model Services')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <label className='flex items-center gap-2 text-base text-slate-500'>
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          {t('Auto refresh')}
        </label>
        <Button
          variant='outline'
          size='pill'
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw className={query.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {query.isLoading ? (
          <div className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className='h-28 rounded-2xl' />
              ))}
            </div>
            <Skeleton className='h-80 rounded-2xl' />
          </div>
        ) : !data || query.isError || query.data?.success === false ? (
          <Alert variant='destructive'>
            <Server className='size-4' />
            <AlertTitle>{t('Unable to load model services')}</AlertTitle>
            <AlertDescription>
              {query.data?.message || t('Check the appliance service and try again.')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              {summaryCards.map((card) => {
                const Icon = card.icon
                return (
                  <Card key={card.label} className='gap-2'>
                    <CardContent className='flex items-center justify-between gap-4'>
                      <div>
                        <p className='text-base text-slate-500'>{card.label}</p>
                        <p className='mt-2 font-mono text-4xl font-semibold text-slate-950'>
                          {card.value}
                        </p>
                      </div>
                      <span
                        className={`flex size-11 items-center justify-center rounded-2xl ${card.color}`}
                      >
                        <Icon className='size-5' />
                      </span>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <RoutingPolicyCard policy={data.routing_policy} />

            {data.services.length === 0 ? (
              <Card>
                <CardContent className='flex flex-col items-center py-12 text-center'>
                  <Boxes className='size-10 text-slate-300' />
                  <h3 className='mt-4 text-xl font-semibold text-slate-900'>
                    {t('No model service is configured')}
                  </h3>
                  <p className='mt-2 max-w-xl text-base leading-7 text-slate-500'>
                    {t(
                      'Model services are provisioned by system maintenance personnel and will appear here when ready.'
                    )}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className='space-y-4'>
                {data.services.map((service) => (
                  <ModelServiceCard key={service.name} service={service} />
                ))}
              </div>
            )}
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
