/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 套餐专用 Key 管理弹窗。
 *
 * 这把 Key 只在这里管理:API 密钥页(/keys)已按 `user_subscription_id = 0`
 * 把它排除掉了,那边本来也不允许改名/删除。Key 在购买时由后端自动签发,
 * 用户在这里能做的只有「看 / 复制 / 重新签发」。
 *
 * 重新签发 = 旧 Key **立即失效**(后端事务里删旧建新 + 清 Redis 缓存),
 * 所以必须走二次确认。
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getSubscriptionKey,
  rotateSubscriptionKey,
} from '@/features/subscriptions/api'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** user_subscriptions.id */
  subscriptionId?: number
  planLabel?: string
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 12) return '•'.repeat(key.length)
  return `${key.slice(0, 7)}${'•'.repeat(16)}${key.slice(-4)}`
}

export function SubscriptionKeyDialog(props: Props) {
  const { t } = useTranslation()
  const { open, subscriptionId } = props

  const [loading, setLoading] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  const fetchKey = useCallback(async (id: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await getSubscriptionKey(id)
      if (res.success) {
        // key 为空 = 该订阅还没签发过(历史数据),不是错误
        setApiKey(res.data?.key || '')
      } else {
        setError(res.message || '')
      }
    } catch {
      setError('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !subscriptionId) return
    // 每次打开都重新拉:轮换过的话缓存的旧值会误导用户。
    // 延迟一拍再置状态,避免 effect 内同步 setState 触发级联渲染。
    const timer = setTimeout(() => {
      setRevealed(false)
      setCopied(false)
      setConfirmRotate(false)
      void fetchKey(subscriptionId)
    }, 0)
    return () => clearTimeout(timer)
  }, [open, subscriptionId, fetchKey])

  const handleCopy = async () => {
    const ok = await copyToClipboard(apiKey)
    if (!ok) {
      toast.error(t('Copy failed'))
      return
    }
    setCopied(true)
    toast.success(t('Copied to clipboard'))
    setTimeout(() => setCopied(false), 2000)
  }

  const handleRotate = async () => {
    if (!subscriptionId) return
    setRotating(true)
    try {
      const res = await rotateSubscriptionKey(subscriptionId)
      if (res.success && res.data?.key) {
        const hadKey = !!apiKey
        setApiKey(res.data.key)
        setRevealed(true)
        setConfirmRotate(false)
        toast.success(
          hadKey
            ? t('The key has been reset. The old key stopped working.')
            : t('Key issued.')
        )
      } else {
        toast.error(res.message || t('Failed to reset the key'))
      }
    } catch {
      toast.error(t('Failed to reset the key'))
    } finally {
      setRotating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Subscription Key')}</DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          <p className='text-muted-foreground text-sm'>
            {props.planLabel}
            {props.planLabel ? ' · ' : ''}
            {t(
              'Calls made with this key are billed against the plan quota only, never your wallet balance.'
            )}
          </p>

          {loading ? (
            <Skeleton className='h-11 w-full rounded-xl' />
          ) : apiKey ? (
            <div className='bg-muted/50 flex items-center gap-2 rounded-xl px-3 py-2.5'>
              <span className='flex-1 text-sm break-all tabular-nums'>
                {revealed ? apiKey : maskKey(apiKey)}
              </span>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 shrink-0'
                onClick={() => setRevealed((v) => !v)}
                aria-label={revealed ? t('Hide') : t('Show')}
              >
                {revealed ? (
                  <EyeOff className='h-4 w-4' />
                ) : (
                  <Eye className='h-4 w-4' />
                )}
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8 shrink-0'
                onClick={handleCopy}
                aria-label={t('Copy')}
              >
                {copied ? (
                  <Check className='h-4 w-4 text-green-600' />
                ) : (
                  <Copy className='h-4 w-4' />
                )}
              </Button>
            </div>
          ) : (
            <p className='text-muted-foreground text-sm'>
              {error ||
                t(
                  'This subscription has no key yet. Issue one to start using it.'
                )}
            </p>
          )}

          {confirmRotate && apiKey ? (
            <div className='border-destructive/30 bg-destructive/5 space-y-3 rounded-xl border p-4'>
              <p className='text-sm font-medium'>
                {t('Reset the key for this subscription?')}
              </p>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'The current key stops working immediately. Any service still using it will start failing authentication.'
                )}
              </p>
              <div className='flex justify-end gap-2'>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setConfirmRotate(false)}
                  disabled={rotating}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant='destructive'
                  size='sm'
                  onClick={handleRotate}
                  disabled={rotating}
                >
                  {rotating && (
                    <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                  )}
                  {t('Confirm')}
                </Button>
              </div>
            </div>
          ) : (
            <div className='flex justify-end'>
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  apiKey ? setConfirmRotate(true) : handleRotate()
                }
                disabled={loading || rotating}
              >
                {rotating ? (
                  <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                ) : (
                  <RefreshCw className='mr-1.5 h-3.5 w-3.5' />
                )}
                {apiKey ? t('Reset key') : t('Issue key')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
