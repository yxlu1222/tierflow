/*
Copyright (C) 2023-2026 TierFlow
*/
import { api } from '@/lib/api'
import type {
  ApplianceDeviceStatus,
  ApplianceModelServicesData,
  ApplianceResponse,
  ClusterNodeStatus,
} from './types'

export async function getApplianceDeviceStatus(): Promise<
  ApplianceResponse<ApplianceDeviceStatus>
> {
  const response = await api.get('/api/appliance/device/status', {
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return response.data
}

export async function getApplianceModelServices(
  hours = 24
): Promise<ApplianceResponse<ApplianceModelServicesData>> {
  const response = await api.get('/api/appliance/model_services', {
    params: { hours },
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return response.data
}

export async function getClusterNodes(): Promise<
  ApplianceResponse<ClusterNodeStatus[]>
> {
  const response = await api.get('/api/cluster/nodes', {
    disableDuplicate: true,
    skipErrorHandler: true,
  })
  return response.data
}
