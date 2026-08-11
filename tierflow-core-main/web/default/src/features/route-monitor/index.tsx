/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
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
import { getRouteMonitor } from './api'
import type { RouteDecision } from './types'

const POLL_INTERVAL_MS = 3000

const TIER_LABEL: Record<number, string> = {
  1: 'tier1',
  2: 'tier2',
  3: 'tier3',
  4: 'tier4',
  5: 'tier5',
}

function fmtTime(unixSec: number) {
  if (!unixSec) return '—'
  const d = new Date(unixSec * 1000)
  return d.toLocaleTimeString()
}

export function RouteMonitor() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<RouteDecision[]>([])
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getRouteMonitor(200)
      if (res.success) setRows(res.data || [])
    } catch {
      /* ignore transient errors during polling */
    } finally {
      setLoading(false)
    }
  }, [])

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

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Route Monitor')}</SectionPageLayout.Title>
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
        <p className='text-muted-foreground mb-3 text-sm'>
          {t(
            'Live view of auto-routing decisions: the alias requested, the difficulty score from tierflow-infer, the matched tier, and the model it routed to. Most recent first (last 500 kept in memory).'
          )}
        </p>
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Time')}</TableHead>
                <TableHead>{t('Request scheme')}</TableHead>
                <TableHead>{t('Score')}</TableHead>
                <TableHead>{t('Tier')}</TableHead>
                <TableHead>{t('Matched model')}</TableHead>
                <TableHead>{t('User / Token')}</TableHead>
                <TableHead>{t('Route latency')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className='text-muted-foreground py-10 text-center'
                  >
                    {loading ? t('Loading...') : t('No routing records yet')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r, i) => (
                  <TableRow key={`${r.request_id}-${i}`}>
                    <TableCell className='font-mono text-xs whitespace-nowrap'>
                      {fmtTime(r.time)}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>{r.alias}</TableCell>
                    <TableCell>
                      {r.scored ? (
                        <span className='font-medium'>{r.score.toFixed(2)}</span>
                      ) : (
                        <Badge variant='secondary'>{t('fallback')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant='default'>
                        {TIER_LABEL[r.tier] || `tier${r.tier}`}
                      </Badge>
                    </TableCell>
                    <TableCell className='font-medium'>{r.model}</TableCell>
                    <TableCell className='text-muted-foreground text-xs'>
                      {r.user_id ? `#${r.user_id}` : ''}
                      {r.token_name ? ` / ${r.token_name}` : ''}
                    </TableCell>
                    <TableCell className='font-mono text-xs whitespace-nowrap'>
                      {r.route_ms}ms
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Frame>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
