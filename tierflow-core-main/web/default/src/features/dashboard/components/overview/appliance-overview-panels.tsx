/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  Boxes,
  Cpu,
  HardDrive,
  KeyRound,
  LayoutGrid,
  MemoryStick,
  Microchip,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatNumber } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/features/appliance/lib'
import type {
  ApplianceModelService,
  ClusterNodeStatus,
} from '@/features/appliance/types'

type UsageKpisProps = {
  tokens: number
  requests: number
  avgTtftMs: number
  successRate: number
  loading: boolean
}

export function UsageKpis(props: UsageKpisProps) {
  const { t } = useTranslation()
  const cards = [
    {
      label: t('Tokens today'),
      value: formatNumber(props.tokens),
      detail: t('Consumed since 00:00'),
      icon: Activity,
      tone: 'bg-blue-50 text-blue-600',
    },
    {
      label: t('Requests today'),
      value: formatNumber(props.requests),
      detail: t('Inference requests today'),
      icon: Boxes,
      tone: 'bg-indigo-50 text-indigo-600',
    },
    {
      label: t('Average token latency'),
      value: props.avgTtftMs > 0 ? `${Math.round(props.avgTtftMs)} ms` : '—',
      detail: t('Average first-token latency'),
      icon: Activity,
      tone: 'bg-violet-50 text-violet-600',
    },
    {
      label: t('Success rate'),
      value: props.requests > 0 ? `${props.successRate.toFixed(2)}%` : '—',
      detail: t('Successful requests in the last 24 hours'),
      icon: Activity,
      tone: 'bg-emerald-50 text-emerald-600',
    },
  ]

  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.label} className='gap-2 rounded-2xl py-5'>
            <CardContent className='flex items-start justify-between gap-4 px-5'>
              <div className='min-w-0'>
                <p className='text-base text-slate-500'>{card.label}</p>
                {props.loading ? (
                  <Skeleton className='mt-3 h-9 w-28' />
                ) : (
                  <p className='mt-2 font-mono text-3xl font-semibold tracking-tight text-slate-950 tabular-nums'>
                    {card.value}
                  </p>
                )}
                <p className='mt-2 text-sm text-slate-400'>{card.detail}</p>
              </div>
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-2xl ${card.tone}`}
              >
                <Icon className='size-5' />
              </span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function Meter(props: {
  icon: React.ElementType
  label: string
  value: number
  detail: string
}) {
  const Icon = props.icon
  const value = Math.max(0, Math.min(100, props.value || 0))
  return (
    <div className='rounded-xl bg-slate-50 p-3.5'>
      <div className='flex items-center justify-between gap-3'>
        <span className='flex items-center gap-2 text-sm text-slate-500'>
          <Icon className='size-4' />
          {props.label}
        </span>
        <span className='font-mono text-sm font-semibold text-slate-800'>
          {value.toFixed(0)}%
        </span>
      </div>
      <Progress value={value} className='mt-3 h-1.5' />
      <p className='mt-2 min-h-5 text-xs leading-5 break-words text-slate-400'>
        {props.detail}
      </p>
    </div>
  )
}

function DashboardDeviceCard(props: {
  node: ClusterNodeStatus
  deviceNumber: number
}) {
  const { t } = useTranslation()
  const node = props.node
  const online = node.status === 'online' && !node.stale
  const memoryUsed = Math.max(
    0,
    node.memory_total_bytes - node.memory_available_bytes
  )
  const diskUsed = Math.max(
    0,
    node.disk_total_bytes - node.disk_available_bytes
  )
  const memoryUsage = node.memory_total_bytes
    ? (memoryUsed / node.memory_total_bytes) * 100
    : 0
  const diskUsage = node.disk_total_bytes
    ? (diskUsed / node.disk_total_bytes) * 100
    : 0
  const address = node.fabric_ip || node.wifi_ip

  return (
    <section className='overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white p-4'>
        <div className='flex min-w-0 items-center gap-3'>
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-xl font-mono text-lg font-semibold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
          >
            {props.deviceNumber}
          </div>
          <div className='min-w-0'>
            <p className='truncate text-base font-semibold text-slate-950'>
              {node.name}
            </p>
            <p className='mt-0.5 truncate font-mono text-xs text-slate-500'>
              {address || node.hostname || t('No network address')}
            </p>
          </div>
        </div>
        <div className='flex flex-wrap justify-end gap-1.5'>
          <Badge
            className={
              online
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }
          >
            <span
              className={`size-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`}
            />
            {online ? t('Online') : t('Offline')}
          </Badge>
          <Badge variant='outline'>
            {node.role === 'controller' ? t('Controller') : t('Worker')}
          </Badge>
        </div>
      </div>

      <div className='grid gap-3 p-4 sm:grid-cols-2'>
        <Meter
          icon={Cpu}
          label='CPU'
          value={node.cpu_usage_percent}
          detail={t('Current compute load')}
        />
        <Meter
          icon={MemoryStick}
          label={t('Unified memory')}
          value={memoryUsage}
          detail={`${formatBytes(memoryUsed)} / ${formatBytes(node.memory_total_bytes)}`}
        />
        <Meter
          icon={Microchip}
          label='GPU'
          value={node.cuda_utilization_percent}
          detail={
            node.cuda_available
              ? node.cuda_name || 'NVIDIA GPU'
              : t('Not available')
          }
        />
        <Meter
          icon={HardDrive}
          label={t('Disk')}
          value={diskUsage}
          detail={`${formatBytes(diskUsed)} / ${formatBytes(node.disk_total_bytes)}`}
        />
      </div>
    </section>
  )
}

export function DeviceSummary(props: {
  nodes?: ClusterNodeStatus[]
  loading: boolean
}) {
  const { t } = useTranslation()
  const nodes = props.nodes ?? []
  const orderedNodes = nodes.slice().sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === 'controller' ? -1 : 1
    }
    if (left.id !== right.id) return left.id - right.id
    return left.name.localeCompare(right.name)
  })
  const onlineCount = nodes.filter(
    (node) => node.status === 'online' && !node.stale
  ).length

  return (
    <Card className='rounded-2xl'>
      <CardHeader className='flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle className='text-lg'>
            {t('Device status summary')}
          </CardTitle>
          <p className='mt-1 text-sm text-slate-500'>
            {t('Controller and worker nodes')}
          </p>
        </div>
        <Badge className='bg-emerald-50 text-emerald-700'>
          {onlineCount} / {nodes.length} {t('Online')}
        </Badge>
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <div className='grid gap-4 xl:grid-cols-2'>
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className='h-80 rounded-2xl' />
            ))}
          </div>
        ) : nodes.length > 0 ? (
          <div className='grid gap-4 xl:grid-cols-2'>
            {orderedNodes.map((node, index) => (
              <DashboardDeviceCard
                key={node.id}
                node={node}
                deviceNumber={index + 1}
              />
            ))}
          </div>
        ) : (
          <p className='py-8 text-center text-base text-slate-500'>
            {t('Device metrics are available to appliance administrators.')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function DeployedModels(props: {
  services: ApplianceModelService[]
  models: string[]
  loading: boolean
  isAdmin: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const rows =
    props.services.length > 0
      ? props.services.slice(0, 5)
      : props.models.slice(0, 5).map((name) => ({
          name,
          state: 'running' as const,
          deployment_scope: 'local' as const,
          runtimes: [],
          available_instances: 1,
          total_instances: 1,
        }))

  return (
    <Card className='rounded-2xl'>
      <CardHeader className='flex-row items-start justify-between gap-4'>
        <div>
          <CardTitle className='text-lg'>{t('Deployed models')}</CardTitle>
          <p className='mt-1 text-sm text-slate-500'>
            {t('Models currently available through this appliance')}
          </p>
        </div>
        {props.isAdmin && (
          <Button
            variant='outline'
            size='sm'
            className='rounded-full'
            onClick={() => void navigate({ to: '/model-services' })}
          >
            {t('View all')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {props.loading ? (
          <div className='space-y-3'>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className='h-14 rounded-xl' />
            ))}
          </div>
        ) : rows.length > 0 ? (
          <div className='space-y-2'>
            {rows.map((model) => (
              <div
                key={model.name}
                className='flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3'
              >
                <span className='flex size-9 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm'>
                  <Boxes className='size-4.5' />
                </span>
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-mono text-base font-medium text-slate-900'>
                    {model.name}
                  </p>
                  <p className='mt-0.5 text-sm text-slate-500'>
                    {model.deployment_scope === 'local'
                      ? t('Local model')
                      : t('Inference service')}
                  </p>
                </div>
                <Badge
                  className={
                    model.state === 'running'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                  }
                >
                  {model.state === 'running'
                    ? t('Running')
                    : t('Needs attention')}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className='py-8 text-center text-base text-slate-500'>
            {t('No model service is configured')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function PeopleAndSkillsSummary(props: {
  userCount: number
  apiKeyCount: number
  skillCount: number
  teamSkillCount: number
  loading: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const items = [
    {
      label: t('Users'),
      value: props.userCount,
      icon: UsersRound,
      action: () => void navigate({ to: '/users' }),
    },
    {
      label: t('Active API Keys'),
      value: props.apiKeyCount,
      icon: KeyRound,
      action: () => void navigate({ to: '/keys' }),
    },
    {
      label: t('Installed Skills'),
      value: props.skillCount,
      icon: LayoutGrid,
      action: () => void navigate({ to: '/skills' }),
    },
    {
      label: t('Team shared Skills'),
      value: props.teamSkillCount,
      icon: UsersRound,
      action: () => void navigate({ to: '/skills' }),
    },
  ]

  return (
    <Card className='rounded-2xl'>
      <CardHeader>
        <CardTitle className='text-lg'>{t('Users and Skills')}</CardTitle>
        <p className='text-sm text-slate-500'>
          {t('Current access and capability overview')}
        </p>
      </CardHeader>
      <CardContent className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {items.map((item) => {
          const Icon = item.icon
          return (
            <button
              type='button'
              key={item.label}
              onClick={item.action}
              className='rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/60'
            >
              <div className='flex items-center justify-between gap-3'>
                <span className='text-base text-slate-500'>{item.label}</span>
                <Icon className='size-4.5 text-blue-600' />
              </div>
              {props.loading ? (
                <Skeleton className='mt-3 h-8 w-16' />
              ) : (
                <p className='mt-3 font-mono text-3xl font-semibold text-slate-950 tabular-nums'>
                  {formatNumber(item.value)}
                </p>
              )}
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
