/*
Copyright (C) 2023-2026 TierFlow
*/
import { CacheStatsDialog } from '@/features/system-settings/general/channel-affinity/cache-stats-dialog'
import { UserInfoDialog } from '@/features/usage-logs/components/dialogs/user-info-dialog'
import {
  UsageLogsProvider,
  useUsageLogsContext,
} from '@/features/usage-logs/components/usage-logs-provider'
import { UsageLogsTable } from '@/features/usage-logs/components/usage-logs-table'
import { useApplianceOverview } from '../../hooks/use-appliance-overview'
import { ApplianceHero } from './appliance-hero'
import { ApplianceServiceCards } from './appliance-service-cards'
import { RecentInferenceCalls } from './recent-inference-calls'

function FullActivityLog() {
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
  const appliance = useApplianceOverview()

  return (
    <div className='flex flex-col gap-4 sm:gap-5'>
      <ApplianceHero
        apiKeyCount={appliance.apiKeyCount}
        isAdmin={appliance.isAdmin}
        modelCount={appliance.modelCount}
        requestCount={appliance.overview.totals.totalCount}
        serviceReady={appliance.serviceReady}
        loading={appliance.statusLoading}
      />

      <ApplianceServiceCards
        apiBaseUrl={appliance.apiBaseUrl}
        apiKeyCount={appliance.apiKeyCount}
        apiKeysLoading={appliance.apiKeysLoading}
        isAdmin={appliance.isAdmin}
        modelCount={appliance.modelCount}
        models={appliance.models}
        modelsLoading={appliance.modelsLoading}
        requestCount={appliance.overview.totals.totalCount}
        tokenCount={appliance.overview.totals.totalTokens}
        usageLoading={appliance.overview.loading}
      />

      <UsageLogsProvider>
        <RecentInferenceCalls
          calls={appliance.recentCalls}
          error={appliance.recentCallsError}
          isAdmin={appliance.isAdmin}
          loading={appliance.recentCallsLoading}
          fullLog={<FullActivityLog />}
        />
      </UsageLogsProvider>
    </div>
  )
}
