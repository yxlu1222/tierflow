/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 用户看板首屏。
 *
 * 定位是「轻量展示台」而不是分析工具:用户来这里只解决三件事 —— 看用量、看余额、
 * 买套餐。所以顶部是账户状态(套餐额度 + 余额),中间是近 7 天的三个标量,底部
 * 直接嵌完整活动日志。
 *
 * 刻意去掉的东西:
 * - 顶部的自定义区间选择器 + 时/天粒度切换 —— 日志表自带日期筛选,两个日期
 *   控件同屏会打架;KPI 固定近 7 天即可。
 * - 消费趋势折线图 —— 抽象分析对网关用户是「偶尔看一眼」,不值得占首屏。
 *   管理端的用户分析 / 财务分区仍保留完整图表。
 *
 * 模型维度:普通用户的日志表不再有模型列(逐行模型名是噪声),模型信息改由
 * 「模型调用分布」环图承担 —— 聚合分布才是用户真正能用上的那一层。
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import dayjs from '@/lib/dayjs'
import { CacheStatsDialog } from '@/features/system-settings/general/channel-affinity/cache-stats-dialog'
import { UserInfoDialog } from '@/features/usage-logs/components/dialogs/user-info-dialog'
import {
  UsageLogsProvider,
  useUsageLogsContext,
} from '@/features/usage-logs/components/usage-logs-provider'
import { UsageLogsTable } from '@/features/usage-logs/components/usage-logs-table'
import { useOverviewData } from '../../hooks/use-overview-data'
import { AccountStrip } from './account-strip'
import { KpiStrip } from './kpi-strip'
import { ModelShareChart } from './model-share-chart'

/** KPI 的固定观察窗口。日志表的时间范围由它自己的筛选器控制,与此无关。 */
const KPI_WINDOW_DAYS = 7

/**
 * 活动日志整表 —— 直接复用日志页的表格与筛选/导出,不另做精简版,避免同一份
 * 数据出现两套渲染。/usage-logs 路由保持不变,这里只是多挂一份。
 */
function ActivityLog() {
  const {
    selectedUserId,
    userInfoDialogOpen,
    setUserInfoDialogOpen,
    affinityTarget,
    affinityDialogOpen,
    setAffinityDialogOpen,
  } = useUsageLogsContext()

  return (
    <>
      <UsageLogsTable logCategory='common' />

      <UserInfoDialog
        userId={selectedUserId}
        open={userInfoDialogOpen}
        onOpenChange={setUserInfoDialogOpen}
      />

      <CacheStatsDialog
        open={affinityDialogOpen}
        onOpenChange={setAffinityDialogOpen}
        target={
          affinityTarget
            ? {
                rule_name: affinityTarget.rule_name || '',
                using_group:
                  affinityTarget.using_group ||
                  affinityTarget.selected_group ||
                  '',
                key_hint: affinityTarget.key_hint || '',
                key_fp: affinityTarget.key_fp || '',
              }
            : null
        }
      />
    </>
  )
}

export function OverviewDashboard() {
  const { t } = useTranslation()

  // 固定近 7 天,按天分桶。只算一次,避免每次渲染换 queryKey 反复取数。
  const { startTimestamp, endTimestamp } = useMemo(() => {
    const end = dayjs().endOf('hour')
    return {
      startTimestamp: end.subtract(KPI_WINDOW_DAYS, 'day').unix(),
      endTimestamp: end.unix(),
    }
  }, [])

  const overview = useOverviewData({ startTimestamp, endTimestamp })

  const rangeLabel = t('Last {{count}} days', { count: KPI_WINDOW_DAYS })

  return (
    <div className='dash-console flex flex-col gap-4'>
      <AccountStrip />
      {/* 左:近 7 天三项标量(单卡纵向);右:模型调用分布环图。等宽两栏。
          用 minmax(0,1fr) 而不是 grid-cols-2:后者的 1fr 最小尺寸是 auto,
          图表/长模型名会把栏宽顶开导致溢出。 */}
      <div className='grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
        <KpiStrip overview={overview} rangeLabel={rangeLabel} />
        {/* 环图自己持有时间窗(今天/近 7 天/近 30 天)与取数,所以不吃 KPI 的固定
            7 天,也不从这里透传 rows —— 两侧的时间口径可以不一致,各自卡上都写着。 */}
        <ModelShareChart />
      </div>
      <UsageLogsProvider>
        <ActivityLog />
      </UsageLogsProvider>
    </div>
  )
}
