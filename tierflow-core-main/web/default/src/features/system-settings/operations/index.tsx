/*
Copyright (C) 2023-2026 TierFlow
*/
import { useStatus } from '@/hooks/use-status'
import { SettingsPage } from '../components/settings-page'
import type { OperationsSettings } from '../types'
import {
  OPERATIONS_DEFAULT_SECTION,
  getOperationsSectionContent,
  getOperationsSectionMeta,
} from './section-registry.tsx'

const defaultOperationsSettings: OperationsSettings = {
  RetryTimes: 2,
  DefaultCollapseSidebar: false,
  DemoSiteEnabled: false,
  SelfUseModeEnabled: false,
  ChannelDisableThreshold: '',
  QuotaRemindThreshold: '',
  AutomaticDisableChannelEnabled: false,
  AutomaticEnableChannelEnabled: false,
  AutomaticDisableKeywords: '',
  AutomaticDisableStatusCodes: '401',
  AutomaticRetryStatusCodes:
    '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
  RouteBreakerEnabled: true,
  BreakerKeyLevelEnabled: true,
  BreakerFailureThreshold: 3,
  BreakerWindowSeconds: 60,
  BreakerCooldownSeconds: 30,
  BreakerMaxCooldownSeconds: 300,
  BreakerTripStatusCodes: '429,500-504,520-599',
  'monitor_setting.auto_test_channel_enabled': false,
  'monitor_setting.auto_test_channel_minutes': 10,
  SMTPServer: '',
  SMTPPort: '',
  SMTPAccount: '',
  SMTPFrom: '',
  SMTPToken: '',
  SMTPSSLEnabled: false,
  SMTPForceAuthLogin: false,
  WorkerUrl: '',
  WorkerValidKey: '',
  WorkerAllowHttpImageRequestEnabled: false,
  LogConsumeEnabled: false,
  'performance_setting.disk_cache_enabled': false,
  'performance_setting.disk_cache_threshold_mb': 10,
  'performance_setting.disk_cache_max_size_mb': 1024,
  'performance_setting.disk_cache_path': '',
  'performance_setting.monitor_enabled': false,
  'performance_setting.monitor_cpu_threshold': 90,
  'performance_setting.monitor_memory_threshold': 90,
  'performance_setting.monitor_disk_threshold': 95,
  'perf_metrics_setting.enabled': true,
  'perf_metrics_setting.flush_interval': 5,
  'perf_metrics_setting.bucket_time': 'hour',
  'perf_metrics_setting.retention_days': 0,
  // ⚠️ 这些默认值必须与 setting/operation_setting/message_capture_setting.go 的
  // messageCaptureSetting 一致：getOptionValue 用 `typeof 默认值` 决定如何解析
  // 接口返回的字符串,且只保留 defaults 里存在的 key —— 漏一个就等于该项永远读不到。
  'message_capture_setting.enabled': false,
  'message_capture_setting.dir': 'messages',
  'message_capture_setting.quota_per_day': 200,
  'message_capture_setting.max_content_bytes': 32768,
  'message_capture_setting.max_tee_bytes': 2097152,
  'message_capture_setting.max_req_body_bytes': 10485760,
  'message_capture_setting.max_replay_messages': 50,
  'message_capture_setting.queue_size': 512,
  'message_capture_setting.exclude_user_ids': '',
}

export function OperationsSettings() {
  const { status } = useStatus()

  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/operations/$section'
      defaultSettings={defaultOperationsSettings}
      defaultSection={OPERATIONS_DEFAULT_SECTION}
      getSectionContent={getOperationsSectionContent}
      getSectionMeta={getOperationsSectionMeta}
      extraArgs={[
        status?.version as string | undefined,
        status?.start_time as number | null | undefined,
      ]}
      loadingMessage='Loading maintenance settings...'
    />
  )
}
