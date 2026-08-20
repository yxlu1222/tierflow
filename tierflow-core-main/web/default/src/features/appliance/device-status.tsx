/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Database, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { SectionPageLayout } from '@/components/layout'
import { getApplianceDeviceStatus, getClusterNodes } from './api'
import { ClusterDeviceOverview } from './components/cluster-device-overview'
import { formatDuration } from './lib'

const POLL_INTERVAL_MS = 5000

function DetailRow(props: { label: string; value: React.ReactNode }) {
  return (
    <div className='grid grid-cols-[minmax(7.5rem,0.42fr)_minmax(0,1fr)] items-start gap-4 border-b border-slate-100 py-3 last:border-b-0'>
      <dt className='text-base leading-6 text-slate-500'>{props.label}</dt>
      <dd className='min-w-0 text-right text-base leading-6 font-medium break-words text-slate-800'>
        {props.value}
      </dd>
    </div>
  )
}

export function DeviceStatus() {
  const { t } = useTranslation()
  const [autoRefresh, setAutoRefresh] = useState(true)
  const query = useQuery({
    queryKey: ['appliance', 'device-status'],
    queryFn: getApplianceDeviceStatus,
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  })
  const clusterQuery = useQuery({
    queryKey: ['cluster', 'nodes'],
    queryFn: getClusterNodes,
    refetchInterval: autoRefresh ? POLL_INTERVAL_MS : false,
  })
  const data = query.data?.data

  useEffect(() => {
    if (query.data?.success !== false && clusterQuery.data?.success !== false) {
      return
    }
    const timeout = window.setTimeout(() => setAutoRefresh(false), 0)
    return () => window.clearTimeout(timeout)
  }, [clusterQuery.data?.success, query.data?.success])

  const refreshing = query.isFetching || clusterQuery.isFetching

  function refreshAll() {
    void Promise.all([query.refetch(), clusterQuery.refetch()])
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Device Management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <label className='flex items-center gap-2 text-base text-slate-500'>
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
          {t('Auto refresh')}
        </label>
        <Button
          variant='outline'
          size='pill'
          onClick={refreshAll}
          disabled={refreshing}
        >
          <RefreshCw
            className={refreshing ? 'size-4 animate-spin' : 'size-4'}
          />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <ClusterDeviceOverview
            nodes={clusterQuery.data?.data}
            loading={clusterQuery.isLoading}
            failed={
              clusterQuery.isError || clusterQuery.data?.success === false
            }
            message={clusterQuery.data?.message}
          />

          {query.isLoading ? (
            <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className='h-36 rounded-2xl' />
              ))}
            </div>
          ) : !data || query.isError || query.data?.success === false ? (
            <Alert variant='destructive'>
              <Server className='size-4' />
              <AlertTitle>{t('Unable to load controller details')}</AlertTitle>
              <AlertDescription>
                {query.data?.message ||
                  t('Check the appliance service and try again.')}
              </AlertDescription>
            </Alert>
          ) : (
            <div className='grid gap-4 xl:grid-cols-2'>
              <Card className='gap-3 rounded-2xl border-slate-200/80 shadow-sm'>
                <CardHeader className='border-b border-slate-100 pb-4'>
                  <CardTitle className='flex items-center gap-2'>
                    <Server className='size-4.5 text-blue-600' />
                    {t('Device information')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl>
                    <DetailRow label={t('Host name')} value={data.hostname} />
                    <DetailRow
                      label={t('Operating System')}
                      value={[data.platform, data.platform_version]
                        .filter(Boolean)
                        .join(' ')}
                    />
                    <DetailRow
                      label={t('Kernel')}
                      value={`${data.kernel_version} · ${data.architecture}`}
                    />
                    <DetailRow
                      label={t('CPU model')}
                      value={data.cpu.model || t('Not available')}
                    />
                    <DetailRow
                      label={t('CPU topology')}
                      value={`${data.cpu.physical_cores} / ${data.cpu.logical_cores}`}
                    />
                    <DetailRow
                      label={t('CPU temperature')}
                      value={
                        data.cpu.temperature_celsius == null
                          ? t('Not available')
                          : `${data.cpu.temperature_celsius.toFixed(0)}°C`
                      }
                    />
                    <DetailRow
                      label={t('System uptime')}
                      value={formatDuration(data.uptime_seconds)}
                    />
                  </dl>
                </CardContent>
              </Card>

              <Card className='gap-3 rounded-2xl border-slate-200/80 shadow-sm'>
                <CardHeader className='border-b border-slate-100 pb-4'>
                  <CardTitle className='flex items-center gap-2'>
                    <Box className='size-4.5 text-indigo-600' />
                    {t('TierFlow service')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl>
                    <DetailRow
                      label={t('Status')}
                      value={
                        <Badge className='bg-emerald-50 text-emerald-700'>
                          {t('Running')}
                        </Badge>
                      }
                    />
                    <DetailRow
                      label={t('Version')}
                      value={data.application.version}
                    />
                    <DetailRow
                      label={t('Node name')}
                      value={data.application.node_name}
                    />
                    <DetailRow
                      label={t('Application uptime')}
                      value={formatDuration(data.application.uptime_seconds)}
                    />
                    <DetailRow
                      label={t('Runtime')}
                      value={
                        data.application.containerized ? 'Docker' : 'Native'
                      }
                    />
                    <DetailRow
                      label={t('Database')}
                      value={
                        <span className='inline-flex items-center gap-1.5'>
                          <Database className='size-3.5 text-emerald-600' />
                          {data.application.database_status === 'running'
                            ? t('Healthy')
                            : t('Error')}
                        </span>
                      }
                    />
                    <DetailRow
                      label={t('Last updated')}
                      value={new Date(
                        data.updated_at * 1000
                      ).toLocaleTimeString()}
                    />
                  </dl>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
