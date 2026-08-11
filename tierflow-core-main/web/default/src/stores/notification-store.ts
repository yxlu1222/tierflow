/*
Copyright (C) 2023-2026 TierFlow
*/
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface NotificationState {
  // Array of read announcement keys (id or content hash)
  readAnnouncementKeys: string[]

  // Actions
  markAnnouncementsRead: (keys: string[]) => void
  isAnnouncementRead: (key: string) => boolean
}

/**
 * Notification store for tracking read status of announcements.
 * Persists to localStorage to maintain state across sessions.
 */
export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      readAnnouncementKeys: [],

      markAnnouncementsRead: (keys: string[]) => {
        set((state) => ({
          readAnnouncementKeys: [
            ...new Set([...state.readAnnouncementKeys, ...keys]),
          ],
        }))
      },

      isAnnouncementRead: (key: string) => {
        return get().readAnnouncementKeys.includes(key)
      },
    }),
    {
      name: 'notification-storage',
      partialize: (state) => ({
        readAnnouncementKeys: state.readAnnouncementKeys,
      }),
    }
  )
)
