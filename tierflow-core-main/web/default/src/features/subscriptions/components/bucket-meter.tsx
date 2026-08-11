/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 双桶额度的进度条。用量信息页(/usage)和套餐页(/subscription)共用同一个,
 * 因为两个桶的零值语义很容易写错,复制一份就等于多一处会写歪的地方。
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'

export interface BucketMeterProps {
  label: string
  total: number
  used: number
  format: (value: number) => string
  /**
   * 两个桶的 0 语义不同,必须显式声明(与 model.GetSubscriptionBucketBalances 对齐):
   * - premium:`amount_total <= 0` 即无限 → 'unlimited'
   * - basic:`-1` 无限、`0` 未配置(不渲染)→ 'hidden'
   */
  zeroMeans: 'unlimited' | 'hidden'
}

/**
 * 进度条一律表示**剩余**:没用过就是满格 100%,用多少扣多少;无限档恒为满格。
 * 用「已用」做进度会让刚开通的套餐显示成空条,反直觉。
 */
export function BucketMeter({
  label,
  total,
  used,
  format,
  zeroMeans,
}: BucketMeterProps) {
  const { t } = useTranslation()
  if (total === 0 && zeroMeans === 'hidden') return null

  const unlimited = zeroMeans === 'unlimited' ? total <= 0 : total < 0
  const remaining = unlimited ? 0 : Math.max(0, total - used)
  const remainPercent = unlimited
    ? 100
    : total > 0
      ? Math.max(0, Math.min(100, Math.round((remaining / total) * 100)))
      : 0
  const exhausted = !unlimited && remaining <= 0

  return (
    <div>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
        <span className='text-muted-foreground text-sm'>{label}</span>
        <span
          className={cn(
            'text-sm tabular-nums',
            exhausted ? 'text-destructive font-medium' : 'text-muted-foreground'
          )}
        >
          {unlimited
            ? t('Unlimited')
            : t('{{amount}} left', { amount: format(remaining) })}
        </span>
      </div>
      {/* Progress 的 Track 是内部节点,高度/底色只能用 data-slot 选择器覆盖 */}
      <Progress
        value={remainPercent}
        className={cn(
          '[&_[data-slot=progress-track]]:bg-muted-foreground/15 mt-2 [&_[data-slot=progress-track]]:h-1.5',
          exhausted && '[&_[data-slot=progress-indicator]]:bg-destructive'
        )}
      />
      {/* 桶用尽不会回落到余额扣费,必须说清楚,否则用户会以为「有余额就还能调」 */}
      <p
        className={cn(
          'mt-1.5 text-xs tabular-nums',
          exhausted ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {exhausted
          ? t('Used up — models in this tier are unavailable until renewal')
          : unlimited
            ? `${t('Used')} ${format(used)}`
            : `${format(used)} / ${format(total)} · ${t('{{percent}}% left', {
                percent: remainPercent,
              })}`}
      </p>
    </div>
  )
}
