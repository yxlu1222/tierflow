/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Frame } from '@/components/ui/frame'
import { cn } from '@/lib/utils'
import { getModelChannelMetrics } from './api'
import {
  PROVIDER_STATE_META,
  StateBadge,
  StatusDot,
  TONE_TEXT,
} from './state-meta'
import type { ModelChannelMetric } from './types'

const POLL_INTERVAL_MS = 3000
const route = getRouteApi('/_authenticated/route-monitor/model/$model')

function fmtMs(ms: number) {
  if (!ms || ms <= 0) return '—'
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms}ms`
}

function fmtTps(tps: number) {
  if (!tps || tps <= 0) return '—'
  return `${tps.toFixed(1)}`
}

export function RouteMonitorModelDetail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { model } = route.useParams()
  const [channels, setChannels] = useState<ModelChannelMetric[]>([])
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getModelChannelMetrics(model)
      if (res.success && res.data) setChannels(res.data.channels || [])
    } catch {
      /* ignore transient errors during polling */
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [model])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (live) {
      timer.current = setInterval(load, POLL_INTERVAL_MS)
      return () => {
        if (timer.current) clearInterval(timer.current)
      }
    }
    if (timer.current) clearInterval(timer.current)
    return undefined
  }, [live, load])

  const summary = useMemo(() => {
    const total = channels.length
    const available = channels.filter(
      (c) => c.state === 'healthy' || c.state === 'degraded'
    ).length
    const pct = total > 0 ? Math.round((available / total) * 100) : 0
    return { total, available, pct }
  }, [channels])

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{model}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex items-center gap-2'>
          <Switch checked={live} onCheckedChange={setLive} />
          <span className='text-muted-foreground text-sm'>{t('Live')}</span>
        </div>
        <Button variant='outline' size='pill' onClick={load} disabled={loading}>
          <RefreshCw className='size-4' />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <Button
          variant='ghost'
          size='sm'
          className='mb-3 -ml-2'
          onClick={() => navigate({ to: '/route-monitor' })}
        >
          <ArrowLeft className='size-4' />
          {t('Back to Route Monitor')}
        </Button>

        <div className='mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border bg-muted/30 px-4 py-3'>
          <div>
            <div className='text-muted-foreground text-xs'>
              {t('Model availability')}
            </div>
            <div className='text-2xl font-bold'>{summary.pct}%</div>
          </div>
          <div>
            <div className='text-muted-foreground text-xs'>
              {t('Available channels')}
            </div>
            <div className='text-lg font-semibold'>
              {summary.available} / {summary.total}
            </div>
          </div>
          <p className='text-muted-foreground ml-auto max-w-md text-xs'>
            {t(
              'Per-channel health and performance over the last 24h. Latency, TTFT and throughput are measured from real traffic; channels with no recent traffic show —.'
            )}
          </p>
        </div>

        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Channel')}</TableHead>
                <TableHead>{t('Provider')}</TableHead>
                <TableHead>{t('State')}</TableHead>
                <TableHead className='text-right'>{t('Success Rate')}</TableHead>
                <TableHead className='text-right'>{t('Avg Latency')}</TableHead>
                <TableHead className='text-right'>{t('TTFT')}</TableHead>
                <TableHead className='text-right'>{t('Throughput (tok/s)')}</TableHead>
                <TableHead className='text-right'>{t('Requests (24h)')}</TableHead>
                <TableHead className='text-right'>{t('Cooldown Left')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {channels.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className='text-muted-foreground py-10 text-center'
                  >
                    {!loaded && loading
                      ? t('Loading...')
                      : t('No channels serve this model.')}
                  </TableCell>
                </TableRow>
              ) : (
                channels.map((c) => {
                  const meta = PROVIDER_STATE_META[c.state]
                  return (
                    <TableRow key={c.channel_id}>
                      <TableCell>
                        <div className='flex items-center gap-2'>
                          <StatusDot tone={meta.tone} />
                          <span className='font-medium'>
                            {c.channel_name || `#${c.channel_id}`}
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            #{c.channel_id}
                          </span>
                          {c.is_multi_key && (
                            <span className='text-muted-foreground text-xs'>
                              · {t('Keys')} {c.total_keys - c.cooling_keys}/
                              {c.total_keys}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs'>
                        {c.provider_name}
                      </TableCell>
                      <TableCell>
                        <StateBadge meta={meta} />
                      </TableCell>
                      {c.has_metrics ? (
                        <>
                          <TableCell
                            className={cn(
                              'text-right font-mono text-xs',
                              c.success_rate < 90 && TONE_TEXT.bad,
                              c.success_rate >= 90 &&
                                c.success_rate < 99 &&
                                TONE_TEXT.warn
                            )}
                          >
                            {c.success_rate.toFixed(1)}%
                          </TableCell>
                          <TableCell className='text-right font-mono text-xs'>
                            {fmtMs(c.avg_latency_ms)}
                          </TableCell>
                          <TableCell className='text-right font-mono text-xs'>
                            {fmtMs(c.avg_ttft_ms)}
                          </TableCell>
                          <TableCell className='text-right font-mono text-xs'>
                            {fmtTps(c.avg_tps)}
                          </TableCell>
                          <TableCell className='text-right font-mono text-xs'>
                            {c.request_count.toLocaleString()}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell
                          colSpan={5}
                          className='text-muted-foreground text-center text-xs'
                        >
                          {t('No traffic in the last 24h')}
                        </TableCell>
                      )}
                      <TableCell className='text-right'>
                        {c.cooldown_left > 0 ? (
                          <span
                            className={cn(
                              'font-mono text-xs font-semibold',
                              TONE_TEXT.bad
                            )}
                          >
                            {c.cooldown_left}s
                          </span>
                        ) : (
                          <span className='text-muted-foreground text-xs'>—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </Frame>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
