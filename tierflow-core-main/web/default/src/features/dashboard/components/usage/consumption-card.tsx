/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import type { TimeGranularity } from '@/lib/time'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { ConsumptionDistributionChart } from '../models/consumption-distribution-chart'
import { ConsoleCard } from '../overview/console-card'

interface ConsumptionCardProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity: TimeGranularity
}

/**
 * Left-column Overview card: the 消耗分布 (quota distribution) chart, bar-only,
 * embedded in the shared ConsoleCard frame and filling the card height. The
 * model-group call distribution now lives solely in the 模型组占比 card on the right.
 */
export function ConsumptionCard(props: ConsumptionCardProps) {
  const { t } = useTranslation()
  return (
    <ConsoleCard title={t('Quota Distribution')} className='h-full'>
      <ConsumptionDistributionChart
        embedded
        lockedChartType='bar'
        data={props.data}
        loading={props.loading}
        timeGranularity={props.timeGranularity}
      />
    </ConsoleCard>
  )
}
