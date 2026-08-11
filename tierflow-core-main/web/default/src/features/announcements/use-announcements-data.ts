/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo } from 'react'
import {
  getOptionValue,
  useSystemOptions,
} from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import {
  type Announcement,
  type AnnouncementFormValues,
  type AnnouncementStatus,
  parseAnnouncements,
} from './types'

const ANNOUNCEMENTS_DEFAULTS = {
  'console_setting.announcements': '[]',
}

/**
 * Shared announcements data access. Announcements live as a JSON array string
 * in the `console_setting.announcements` option; every mutation rewrites the
 * whole array. `useUpdateOption` invalidates the `system-options` and `status`
 * queries on success, so the list and dashboard refresh automatically — no
 * local optimistic state is needed.
 */
export function useAnnouncementsData() {
  const { data, isLoading } = useSystemOptions()
  const updateOption = useUpdateOption()

  const announcements = useMemo(
    () =>
      parseAnnouncements(
        getOptionValue(data?.data, ANNOUNCEMENTS_DEFAULTS)[
          'console_setting.announcements'
        ]
      ),
    [data?.data]
  )

  const persist = (nextList: Announcement[]) =>
    updateOption.mutateAsync({
      key: 'console_setting.announcements',
      value: JSON.stringify(nextList),
    })

  const save = async (values: AnnouncementFormValues, editingId?: number) => {
    let nextList: Announcement[]
    if (editingId != null) {
      nextList = announcements.map((item) =>
        item.id === editingId ? { ...item, ...values } : item
      )
    } else {
      const newId = Math.max(0, ...announcements.map((item) => item.id)) + 1
      nextList = [...announcements, { id: newId, ...values }]
    }
    await persist(nextList)
  }

  const togglePin = async (a: Announcement) => {
    const nextList = announcements.map((item) =>
      item.id === a.id ? { ...item, pinned: !item.pinned } : item
    )
    await persist(nextList)
  }

  const toggleStatus = async (a: Announcement) => {
    const nextStatus: AnnouncementStatus =
      a.status === 'published' ? 'draft' : 'published'
    const nextList = announcements.map((item) =>
      item.id === a.id ? { ...item, status: nextStatus } : item
    )
    await persist(nextList)
  }

  const remove = async (a: Announcement) => {
    const nextList = announcements.filter((item) => item.id !== a.id)
    await persist(nextList)
  }

  return {
    announcements,
    isLoading,
    isPending: updateOption.isPending,
    save,
    togglePin,
    toggleStatus,
    remove,
  }
}
