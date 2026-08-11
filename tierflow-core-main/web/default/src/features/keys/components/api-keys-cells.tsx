/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useCallback } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { StatusBadge } from '@/components/status-badge'
import { type ApiKey } from '../types'
import { useApiKeys } from './api-keys-provider'

export function ApiKeyCell({ apiKey }: { apiKey: ApiKey }) {
  const { t } = useTranslation()
  const {
    resolveRealKey,
    resolvedKeys,
    loadingKeys,
    copiedKeyId,
    markKeyCopied,
  } = useApiKeys()
  const [popoverOpen, setPopoverOpen] = useState(false)

  const isLoading = !!loadingKeys[apiKey.id]
  const resolvedFullKey = resolvedKeys[apiKey.id]
  const isCopied = copiedKeyId === apiKey.id
  const maskedKey = `sk-${apiKey.key}`

  const handlePopoverOpen = useCallback(
    (open: boolean) => {
      setPopoverOpen(open)
      if (open && !resolvedFullKey) {
        resolveRealKey(apiKey.id)
      }
    },
    [resolvedFullKey, resolveRealKey, apiKey.id]
  )

  const handleCopy = useCallback(async () => {
    const realKey = resolvedFullKey
    if (!realKey) {
      void resolveRealKey(apiKey.id)
      toast.info(t('API key is loading, please try again in a moment'))
      return
    }
    if (realKey) {
      const ok = await copyToClipboard(realKey)
      if (ok) markKeyCopied(apiKey.id)
    }
  }, [resolvedFullKey, resolveRealKey, apiKey.id, markKeyCopied, t])

  return (
    <div className='flex items-center'>
      <Popover open={popoverOpen} onOpenChange={handlePopoverOpen}>
        <PopoverTrigger
          render={
            <Button
              variant='ghost'
              size='sm'
              className='h-7 text-xs [font-family:var(--font-body)]'
            />
          }
        >
          {maskedKey}
        </PopoverTrigger>
        <PopoverContent
          className='w-auto max-w-[min(90vw,28rem)]'
          align='start'
        >
          <div className='space-y-2'>
            <p className='text-muted-foreground text-xs'>{t('Full API Key')}</p>
            {isLoading ? (
              <div className='flex items-center gap-2 py-2'>
                <Loader2 className='size-3.5 animate-spin' />
                <span className='text-muted-foreground text-xs'>
                  {t('Loading...')}
                </span>
              </div>
            ) : (
              <input
                readOnly
                value={resolvedFullKey || maskedKey}
                autoFocus
                onFocus={(e) => e.target.select()}
                className='bg-muted/50 w-full min-w-[280px] rounded-md border px-3 py-2 [font-family:var(--font-body)] text-xs outline-none'
              />
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon'
              className='size-7 shrink-0'
              onClick={handleCopy}
              onFocus={() => {
                if (!resolvedFullKey) void resolveRealKey(apiKey.id)
              }}
              onPointerEnter={() => {
                if (!resolvedFullKey) void resolveRealKey(apiKey.id)
              }}
              disabled={isLoading}
            />
          }
        >
          {isLoading ? (
            <Loader2 className='size-3.5 animate-spin' />
          ) : isCopied ? (
            <Check className='size-3.5 text-green-600' />
          ) : (
            <Copy className='size-3.5' />
          )}
        </TooltipTrigger>
        <TooltipContent>
          {isLoading
            ? t('Loading...')
            : isCopied
              ? t('Copied!')
              : t('Copy API key')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function ModelLimitsCell({ apiKey }: { apiKey: ApiKey }) {
  const { t } = useTranslation()

  if (!apiKey.model_limits_enabled || !apiKey.model_limits) {
    return <span>{t('Unlimited')}</span>
  }

  const models = apiKey.model_limits.split(',').filter(Boolean)

  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <StatusBadge
          label={t('{{count}} model(s)', { count: models.length })}
          variant='neutral'
          showDot={false}
          copyable={false}
        />
      </TooltipTrigger>
      <TooltipContent side='top' className='max-w-xs'>
        <div className='max-h-[200px] space-y-0.5 overflow-y-auto text-xs'>
          {models.map((m) => (
            <div key={m} className='[font-family:var(--font-body)]'>
              {m}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function IpRestrictionsCell({ apiKey }: { apiKey: ApiKey }) {
  const { t } = useTranslation()
  const allowIps = apiKey.allow_ips?.trim()

  if (!allowIps) {
    return <span>{t('No restriction')}</span>
  }

  const ips = allowIps
    .split('\n')
    .map((ip) => ip.trim())
    .filter(Boolean)

  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>
        <StatusBadge
          label={t('{{count}} IP(s)', { count: ips.length })}
          variant='neutral'
          showDot={false}
          copyable={false}
        />
      </TooltipTrigger>
      <TooltipContent side='top' className='max-w-xs'>
        <div className='max-h-[200px] space-y-0.5 overflow-y-auto text-xs'>
          {ips.map((ip) => (
            <div key={ip} className='[font-family:var(--font-body)]'>
              {ip}
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
