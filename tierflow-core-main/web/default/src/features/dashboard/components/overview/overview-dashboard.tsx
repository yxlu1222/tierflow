/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { useApplianceOverview } from '../../hooks/use-appliance-overview'
import { ApplianceHero } from './appliance-hero'
import {
  DeployedModels,
  DeviceSummary,
  PeopleAndSkillsSummary,
  UsageKpis,
} from './appliance-overview-panels'

export function OverviewDashboard() {
  const { t } = useTranslation()
  const appliance = useApplianceOverview()

  return (
    <div className='flex flex-col gap-4 sm:gap-5'>
      <div>
        <h1 className='text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-[34px]'>
          {t('Overview')}
        </h1>
        <p className='mt-1.5 text-base text-slate-500'>
          {t('TierFlow AI capability center')}
        </p>
      </div>

      <ApplianceHero
        apiKeyCount={appliance.apiKeyCount}
        isAdmin={appliance.isAdmin}
        modelCount={appliance.modelCount}
        requestCount={appliance.overview.totals.totalCount}
        serviceReady={appliance.serviceReady}
        loading={appliance.statusLoading}
      />

      <UsageKpis
        tokens={appliance.overview.totals.totalTokens}
        requests={appliance.overview.totals.totalCount}
        avgTtftMs={appliance.avgTtftMs}
        successRate={appliance.successRate}
        loading={appliance.overview.loading || appliance.performanceLoading}
      />

      <div className='grid gap-4 2xl:grid-cols-[minmax(0,2fr)_minmax(22rem,1fr)]'>
        <DeviceSummary
          nodes={appliance.clusterNodes}
          loading={appliance.clusterLoading}
        />
        <DeployedModels
          services={appliance.modelServices}
          models={appliance.models}
          loading={appliance.modelsLoading}
          isAdmin={appliance.isAdmin}
        />
      </div>

      <PeopleAndSkillsSummary
        userCount={appliance.userCount}
        apiKeyCount={appliance.apiKeyCount}
        skillCount={appliance.skillCount}
        teamSkillCount={appliance.teamSkillCount}
        loading={appliance.usersLoading || appliance.apiKeysLoading}
      />
    </div>
  )
}
