/*
Copyright (C) 2023-2026 TierFlow
*/
export interface ApplianceGPU {
  index: number
  name: string
  uuid: string
  driver_version: string
  temperature_celsius?: number
  utilization_percent?: number
  memory_type: 'dedicated' | 'unified' | 'unavailable'
  memory_total_bytes: number
  memory_used_bytes: number
  memory_used_percent: number
  power_draw_watts?: number
  power_limit_watts?: number
}

export interface ApplianceDeviceStatus {
  updated_at: number
  hostname: string
  platform: string
  platform_version: string
  kernel_version: string
  architecture: string
  uptime_seconds: number
  cpu: {
    model: string
    logical_cores: number
    physical_cores: number
    usage_percent: number
    temperature_celsius?: number
  }
  memory: {
    total: number
    used: number
    available: number
    cached: number
    used_percent: number
  }
  disk: {
    total: number
    free: number
    used: number
    used_percent: number
  }
  gpus: {
    available: boolean
    reason?: string
    items: ApplianceGPU[]
  }
  application: {
    status: string
    version: string
    uptime_seconds: number
    node_name: string
    database_status: string
    containerized: boolean
    runtime: string
  }
}

export interface ClusterModelStatus {
  id: string
  display_name: string
  service: string
  endpoint: string
  channel_id: number
  state: string
  sub_state: string
  main_pid: number
  memory_bytes: number
  endpoint_healthy: boolean
  manifest_present: boolean
}

export interface ClusterNodeStatus {
  id: number
  name: string
  hostname: string
  role: 'controller' | 'worker'
  agent_url: string
  fabric_ip: string
  wifi_ip: string
  status: 'online' | 'offline'
  draining: boolean
  agent_version: string
  memory_total_bytes: number
  memory_available_bytes: number
  cuda_available: boolean
  cuda_name: string
  cuda_memory_total_bytes: number
  cuda_memory_used_bytes: number
  cuda_unified_memory_bytes: number
  disk_total_bytes: number
  disk_available_bytes: number
  last_seen_at: number
  created_time: number
  updated_time: number
  models: ClusterModelStatus[]
  stale: boolean
}

export interface ApplianceModelInstance {
  id: number
  name: string
  runtime: string
  endpoint: string
  state: 'running' | 'degraded' | 'stopped' | 'unavailable'
  local: boolean
  response_time_ms: number
  last_checked_at: number
}

export interface ApplianceModelService {
  name: string
  description?: string
  state: 'running' | 'degraded' | 'stopped' | 'unconfigured'
  deployment_scope: 'local' | 'external' | 'mixed' | 'unconfigured'
  runtimes: string[]
  total_instances: number
  available_instances: number
  request_count_24h: number
  success_rate_24h: number
  avg_latency_ms_24h: number
  avg_tps_24h: number
  instances: ApplianceModelInstance[]
}

export interface ApplianceModelServicesData {
  updated_at: number
  hours: number
  summary: {
    total: number
    running: number
    degraded: number
    stopped: number
    unconfigured: number
  }
  routing_policy: {
    managed: boolean
    mode: 'appliance_managed'
    breaker_enabled: boolean
    failure_threshold: number
    window_seconds: number
    cooldown_seconds: number
    max_cooldown_seconds: number
    key_rotation_enabled: boolean
    max_key_rotations_per_route: number
    max_total_attempts_per_route: number
  }
  services: ApplianceModelService[]
}

export interface ApplianceResponse<T> {
  success: boolean
  message?: string
  data?: T
}
