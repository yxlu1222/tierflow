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
import type { SystemStatus } from '@/features/auth/types'
import { getApiKeys } from '@/features/keys/api'
import { getAllLogs, getUserLogs } from '@/features/usage-logs/api'
import type { UsageLog } from '@/features/usage-logs/data/schema'
import { useOverviewData } from './use-overview-data'

const OVERVIEW_WINDOW_DAYS = 7

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

  const recentCallsQuery = useQuery({
    queryKey: ['appliance', 'recent-inference-calls', isAdmin],
    queryFn: () => {
      const params = { p: 1, page_size: 5, type: 2 }
      return isAdmin ? getAllLogs(params) : getUserLogs(params)
    },
    staleTime: 30 * 1000,
  })

  const models = useMemo(
    () => modelsQuery.data?.data?.filter(Boolean) ?? [],
    [modelsQuery.data]
  )

  const recentCalls = useMemo(
    () =>
      (recentCallsQuery.data?.data?.items ?? [])
        .slice()
        .sort(
          (left, right) => right.created_at - left.created_at
        ) as UsageLog[],
    [recentCallsQuery.data]
  )

  return {
    apiBaseUrl: resolveApiBaseUrl(status),
    apiKeyCount: apiKeysQuery.data?.data?.total ?? 0,
    apiKeysLoading: apiKeysQuery.isLoading,
    isAdmin,
    modelCount: models.length,
    models,
    modelsLoading: modelsQuery.isLoading,
    overview,
    recentCalls,
    recentCallsLoading: recentCallsQuery.isLoading,
    recentCallsError:
      recentCallsQuery.isError || recentCallsQuery.data?.success === false,
    serviceReady: !statusError,
    statusLoading,
  }
}
