/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/auth-store'
import { getUserModels } from '@/lib/api'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { useStatus } from '@/hooks/use-status'
import {
  getApplianceModelServices,
  getClusterNodes,
} from '@/features/appliance/api'
import type { SystemStatus } from '@/features/auth/types'
import { getApiKeys } from '@/features/keys/api'
import { getPerfMetricsSummary } from '@/features/performance-metrics/api'
import { getUsers } from '@/features/users/api'
import { useOverviewData } from './use-overview-data'

const OVERVIEW_WINDOW_DAYS = 1

function resolveApiBaseUrl(status: SystemStatus | null): string {
  const configured =
    status?.api_request_address ??
    status?.data?.api_request_address ??
    status?.server_address ??
    status?.data?.server_address

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const base =
    typeof configured === 'string' && configured ? configured : origin
  return `${base.replace(/\/$/, '')}/v1`
}

export function useApplianceOverview() {
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)
  const isAdmin = role >= ROLE.ADMIN
  const { status, loading: statusLoading, error: statusError } = useStatus()

  const range = useMemo(() => {
    const end = dayjs().endOf('hour')
    return {
      startTimestamp: end.subtract(OVERVIEW_WINDOW_DAYS, 'day').unix(),
      endTimestamp: end.unix(),
    }
  }, [])

  const overview = useOverviewData(range)

  const modelsQuery = useQuery({
    queryKey: ['appliance', 'available-models'],
    queryFn: getUserModels,
    staleTime: 60 * 1000,
  })

  const apiKeysQuery = useQuery({
    queryKey: ['appliance', 'api-keys-summary'],
    queryFn: () => getApiKeys({ p: 1, size: 1 }),
    staleTime: 60 * 1000,
  })

  const clusterQuery = useQuery({
    queryKey: ['cluster', 'overview-nodes'],
    queryFn: getClusterNodes,
    enabled: isAdmin,
    staleTime: 15 * 1000,
  })

  const modelServicesQuery = useQuery({
    queryKey: ['appliance', 'overview-model-services'],
    queryFn: () => getApplianceModelServices(24),
    enabled: isAdmin,
    staleTime: 30 * 1000,
  })

  const usersQuery = useQuery({
    queryKey: ['appliance', 'overview-users'],
    queryFn: () => getUsers({ p: 1, page_size: 1 }),
    enabled: isAdmin,
    staleTime: 60 * 1000,
  })

  const performanceQuery = useQuery({
    queryKey: ['appliance', 'overview-performance', 24],
    queryFn: () => getPerfMetricsSummary(24),
    staleTime: 30 * 1000,
  })

  const models = useMemo(() => {
    const services = modelServicesQuery.data?.data?.services
    if (services) return services.map((service) => service.name)
    return modelsQuery.data?.data?.filter(Boolean) ?? []
  }, [modelServicesQuery.data, modelsQuery.data])

  const performance = useMemo(() => {
    const rows = performanceQuery.data?.data.models ?? []
    let requestCount = 0
    let successCount = 0
    let ttftWeighted = 0
    for (const row of rows) {
      const count = Number(row.request_count || 0)
      requestCount += count
      successCount += count * (Number(row.success_rate || 0) / 100)
      ttftWeighted += count * Number(row.avg_ttft_ms || 0)
    }
    return {
      successRate: requestCount > 0 ? (successCount / requestCount) * 100 : 0,
      avgTtftMs: requestCount > 0 ? ttftWeighted / requestCount : 0,
    }
  }, [performanceQuery.data])

  return {
    apiBaseUrl: resolveApiBaseUrl(status),
    apiKeyCount: apiKeysQuery.data?.data?.total ?? 0,
    apiKeysLoading: apiKeysQuery.isLoading,
    isAdmin,
    modelCount: modelServicesQuery.data?.data?.summary.total ?? models.length,
    models,
    modelServices: modelServicesQuery.data?.data?.services ?? [],
    modelsLoading: modelsQuery.isLoading || modelServicesQuery.isLoading,
    clusterNodes: clusterQuery.data?.data,
    clusterLoading: clusterQuery.isLoading,
    userCount: usersQuery.data?.data?.total ?? 0,
    usersLoading: usersQuery.isLoading,
    skillCount: 0,
    teamSkillCount: 0,
    avgTtftMs: performance.avgTtftMs,
    successRate: performance.successRate,
    performanceLoading: performanceQuery.isLoading,
    overview,
    serviceReady: !statusError,
    statusLoading,
  }
}
