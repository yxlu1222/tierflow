/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useMemo } from 'react'
import { useNotificationStore } from '@/stores/notification-store'
import { useStatus } from '@/hooks/use-status'

function hashString(input: string): string {
  let hash = 0
  if (!input) return '0'

  for (let i = 0; i < input.length; i += 1) {
    const chr = input.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  return hash.toString(36)
}

type AnnouncementKeyInput = {
  id?: number | null
  publishDate?: string | Date
  title?: string
}

/**
 * Generate a stable unique key for an announcement.
 *
 * 公告已「只增不删」,id 是 append-only 的稳定值,优先用它(不再有 id 复用误判);
 * 无 id 的旧数据回退用 title+publishDate 指纹(比 content 指纹更稳,编辑正文不丢已读)。
 */
export function getAnnouncementKey(item: AnnouncementKeyInput): string {
  if (!item) return ''

  if (item.id !== undefined && item.id !== null) {
    return `id:${item.id}`
  }

  const fingerprint = JSON.stringify({
    publishDate: item.publishDate ? String(item.publishDate) : '',
    title: (item.title || '').trim(),
  })
  return `hash:${hashString(fingerprint)}`
}

/**
 * Hook to manage the announcement notification center.
 *
 * The platform has a single announcement model; only published,
 * already-due announcements reach the client (filtered server-side in
 * `/api/status`). This hook exposes the list plus unread bookkeeping.
 */
export function useNotifications() {
  const [popoverOpen, setPopoverOpen] = useState(false)

  // Fetch Announcements from status. 公告面板恒常启用;后端已按 status/发布时间过滤。
  const { status, loading: statusLoading } = useStatus()

  const announcements = (
    (status?.announcements || []) as AnnouncementKeyInput[]
  ).slice(0, 20)

  const { markAnnouncementsRead, isAnnouncementRead } = useNotificationStore()

  // Calculate unread count
  const unreadCount = useMemo(() => {
    return announcements.filter((item) => {
      const key = getAnnouncementKey(item)
      return !isAnnouncementRead(key)
    }).length
  }, [announcements, isAnnouncementRead])

  const markAnnouncementsAsRead = () => {
    if (announcements.length > 0) {
      const allKeys = announcements.map((item) => getAnnouncementKey(item))
      markAnnouncementsRead(allKeys)
    }
  }

  const handleOpenPopover = () => {
    markAnnouncementsAsRead()
    setPopoverOpen(true)
  }

  const handlePopoverOpenChange = (open: boolean) => {
    if (open) {
      handleOpenPopover()
      return
    }

    setPopoverOpen(false)
  }

  return {
    // Data
    announcements,
    loading: statusLoading,

    // Unread count
    unreadCount,

    // Popover state
    popoverOpen,
    setPopoverOpen: handlePopoverOpenChange,

    // Actions
    openPopover: handleOpenPopover,
    closePopover: () => setPopoverOpen(false),
    // Mark every announcement read (used by the full-page notification center).
    markAllRead: markAnnouncementsAsRead,
  }
}
