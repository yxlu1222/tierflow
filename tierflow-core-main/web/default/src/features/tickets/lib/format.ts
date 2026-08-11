/*
Copyright (C) 2023-2026 TierFlow
*/
import i18next from 'i18next'
import { formatTimestampToDate } from '@/lib/format'

// 工单时间戳统一为 unix 秒。近 7 天用（本地化的）相对时间，更早回退到全站统一的绝对日期。
export function formatTicketTime(tsSeconds: number): string {
  if (!tsSeconds) return '-'
  const ms = tsSeconds * 1000
  const diff = Math.max(0, Date.now() - ms)
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return i18next.t('Just now')
  if (diff < hour) {
    return i18next.t('{{count}} minutes ago', { count: Math.floor(diff / min) })
  }
  if (diff < day) {
    return i18next.t('{{count}} hours ago', { count: Math.floor(diff / hour) })
  }
  if (diff < 7 * day) {
    return i18next.t('{{count}} days ago', { count: Math.floor(diff / day) })
  }
  return formatTimestampToDate(tsSeconds)
}
