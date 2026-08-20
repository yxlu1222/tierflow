/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  Activity,
  Boxes,
  CircleGauge,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Server,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { clampPercent, formatBytes } from '../lib'
import type { ClusterModelStatus, ClusterNodeStatus } from '../types'

interface ClusterDeviceOverviewProps {
  nodes?: ClusterNodeStatus[]
  loading: boolean
  failed: boolean
  message?: string
}

function SummaryCard(props: {
  icon: typeof Server
  label: string
  value: string | number
  detail: string
  tone: 'blue' | 'indigo' | 'emerald'
}) {
  const Icon = props.icon
  const toneClasses = {
    blue: 'from-blue-50/80 text-blue-700',
    indigo: 'from-indigo-50/80 text-indigo-700',
    emerald: 'from-emerald-50/80 text-emerald-700',
  }[props.tone]
  return (
    <Card className='gap-3 overflow-hidden rounded-2xl border-slate-200/80 bg-gradient-to-br from-white to-white shadow-sm'>
      <CardContent className='flex items-center gap-4 pt-5'>
        <div
          className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br to-white ${toneClasses}`}
        >
          <Icon className='size-5' aria-hidden='true' />
        </div>
        <div className='min-w-0'>
          <p className='text-sm text-slate-500'>{props.label}</p>
          <p className='mt-0.5 text-2xl font-semibold text-slate-950'>
            {props.value}
          </p>
          <p className='mt-0.5 text-xs leading-5 text-slate-500'>
            {props.detail}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function NodeMeter(props: {
  icon: typeof Server
  label: string
  value: number
  detail: string
  accent?: 'blue' | 'indigo' | 'emerald' | 'amber'
}) {
  const Icon = props.icon
  const accentClasses = {
    blue: {
      bar: 'bg-blue-600',
      icon: 'bg-blue-50 text-blue-700',
    },
    indigo: {
      bar: 'bg-indigo-600',
      icon: 'bg-indigo-50 text-indigo-700',
    },
    emerald: {
      bar: 'bg-emerald-600',
      icon: 'bg-emerald-50 text-emerald-700',
    },
    amber: {
      bar: 'bg-amber-500',
      icon: 'bg-amber-50 text-amber-700',
    },
  }[props.accent ?? 'blue']
  const value = clampPercent(props.value)

  return (
    <div className='rounded-xl border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${accentClasses.icon}`}
          >
            <Icon className='size-4' aria-hidden='true' />
          </div>
          <span className='text-sm leading-5 font-medium text-slate-700'>
            {props.label}
          </span>
        </div>
        <span className='font-mono text-sm font-semibold text-slate-700'>
          {value.toFixed(1)}%
        </span>
      </div>
      <div className='h-2 overflow-hidden rounded-full bg-slate-100'>
        <div
          className={`h-full rounded-full transition-[width] ${accentClasses.bar}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className='mt-1.5 min-h-5 text-xs leading-5 break-words text-slate-500'>
        {props.detail}
      </p>
    </div>
  )
}

function isModelAvailable(model: ClusterModelStatus): boolean {
  return model.state === 'active' && model.endpoint_healthy
}

function ClusterNodeCard(props: {
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
  const memoryPercent = node.memory_total_bytes
    ? (memoryUsed / node.memory_total_bytes) * 100
    : 0
  const diskPercent = node.disk_total_bytes
    ? (diskUsed / node.disk_total_bytes) * 100
    : 0
  const dedicatedCudaMemory = node.cuda_memory_total_bytes > 0
  const cudaPercent = dedicatedCudaMemory
    ? (node.cuda_memory_used_bytes / node.cuda_memory_total_bytes) * 100
    : 0
  const availableModels = node.models.filter(isModelAvailable).length
  const address = node.fabric_ip || node.wifi_ip
  const lastSeenTime = new Date(node.last_seen_at * 1000).toLocaleTimeString()

  return (
    <Card className='gap-4 overflow-hidden rounded-2xl border-slate-200/80 shadow-sm'>
      <CardHeader className='border-b border-slate-100 bg-gradient-to-r from-slate-50/90 to-white pb-4'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 items-start gap-3'>
            <div
              className={`mt-0.5 flex size-12 shrink-0 items-center justify-center rounded-xl font-mono text-xl font-semibold ${online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
              aria-label={`Device ${props.deviceNumber}`}
            >
              {props.deviceNumber}
            </div>
            <div className='min-w-0'>
              <CardTitle className='truncate'>{node.name}</CardTitle>
              <p className='mt-1 truncate text-sm text-slate-500'>
                #{props.deviceNumber} · {node.hostname || t('Unknown host')}
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
              {online ? t('Online') : t('Offline')}
            </Badge>
            <Badge variant='outline'>
              {node.role === 'controller' ? t('Controller') : t('Worker')}
            </Badge>
            {node.draining && (
              <Badge className='bg-amber-50 text-amber-700'>
                {t('Draining')}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className='space-y-5'>
        <div className='grid gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm sm:grid-cols-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <Network className='size-4 shrink-0 text-slate-400' />
            <span className='truncate font-mono text-slate-700'>
              {address || t('No network address')}
            </span>
          </div>
          <div className='text-left text-slate-500 sm:text-right'>
            {t('Last seen')}: {lastSeenTime}
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <NodeMeter
            icon={Cpu}
            label='CPU'
            value={node.cpu_usage_percent}
            detail={t('Current compute load')}
          />
          <NodeMeter
            icon={MemoryStick}
            label={t('Unified memory')}
            value={memoryPercent}
            detail={`${formatBytes(memoryUsed)} / ${formatBytes(node.memory_total_bytes)}`}
            accent='indigo'
          />
          <NodeMeter
            icon={HardDrive}
            label={t('Disk')}
            value={diskPercent}
            detail={`${formatBytes(diskUsed)} / ${formatBytes(node.disk_total_bytes)}`}
            accent='emerald'
          />
          <NodeMeter
            icon={Activity}
            label={t('GPU utilization')}
            value={node.cuda_utilization_percent}
            detail={
              node.cuda_available
                ? node.cuda_name || 'NVIDIA GPU'
                : t('Not available')
            }
            accent='amber'
          />
        </div>

        {node.cuda_available && dedicatedCudaMemory && (
          <div className='rounded-xl border border-slate-100 p-3'>
            <div className='mb-3 flex items-center gap-2 text-sm font-medium text-slate-700'>
              <MemoryStick className='size-4 text-blue-600' />
              <span className='truncate'>{node.cuda_name || 'NVIDIA GPU'}</span>
            </div>
            <NodeMeter
              icon={MemoryStick}
              label={t('Video memory')}
              value={cudaPercent}
              detail={`${formatBytes(node.cuda_memory_used_bytes)} / ${formatBytes(node.cuda_memory_total_bytes)}`}
            />
          </div>
        )}

        <div>
          <div className='mb-2 flex items-center justify-between gap-3'>
            <span className='text-sm font-medium text-slate-700'>
              {t('Registered models')}
            </span>
            <span className='text-xs text-slate-500'>
              {t('{{available}} / {{total}} available', {
                available: availableModels,
                total: node.models.length,
              })}
            </span>
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {node.models.length === 0 ? (
              <span className='text-sm text-slate-500'>
                {t('No model registered')}
              </span>
            ) : (
              node.models.map((model) => (
                <Badge
                  key={model.id}
                  className={
                    isModelAvailable(model)
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-600'
                  }
                >
                  {model.display_name || model.id}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ClusterDeviceOverview(props: ClusterDeviceOverviewProps) {
  const { t } = useTranslation()
  const nodes = props.nodes ?? []
  const orderedNodes = nodes.slice().sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === 'controller' ? -1 : 1
    }
    if (left.id !== right.id) return left.id - right.id
    return left.name.localeCompare(right.name)
  })
  const onlineNodes = nodes.filter(
    (node) => node.status === 'online' && !node.stale
  ).length
  const workerNodes = nodes.filter((node) => node.role === 'worker').length
  const availableModels = nodes.reduce(
    (total, node) => total + node.models.filter(isModelAvailable).length,
    0
  )

  if (props.loading) {
    return (
      <div className='grid gap-4 md:grid-cols-2 2xl:grid-cols-4'>
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className='h-32 rounded-2xl' />
        ))}
      </div>
    )
  }

  if (props.failed) {
    return (
      <Alert variant='destructive'>
        <Server className='size-4' />
        <AlertTitle>{t('Unable to load cluster devices')}</AlertTitle>
        <AlertDescription>
          {props.message || t('Check the node agents and try again.')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <section className='space-y-4' aria-label={t('Cluster devices')}>
      <div className='grid gap-4 sm:grid-cols-3'>
        <SummaryCard
          icon={CircleGauge}
          label={t('Online devices')}
          value={`${onlineNodes} / ${nodes.length}`}
          detail={t('Controller and worker nodes')}
          tone='emerald'
        />
        <SummaryCard
          icon={Network}
          label={t('Worker nodes')}
          value={workerNodes}
          detail={t('Connected compute devices')}
          tone='blue'
        />
        <SummaryCard
          icon={Boxes}
          label={t('Available model instances')}
          value={availableModels}
          detail={t('Healthy inference endpoints')}
          tone='indigo'
        />
      </div>

      {nodes.length === 0 ? (
        <Alert>
          <Server className='size-4' />
          <AlertTitle>{t('No cluster device registered')}</AlertTitle>
          <AlertDescription>
            {t('Install and start a Node Agent to register a device.')}
          </AlertDescription>
        </Alert>
      ) : (
        <div className='grid gap-4 xl:grid-cols-2'>
          {orderedNodes.map((node, index) => (
            <ClusterNodeCard
              key={node.id}
              node={node}
              deviceNumber={index + 1}
            />
          ))}
        </div>
      )}
    </section>
  )
}
