/*
Copyright (C) 2023-2026 TierFlow
*/
import * as z from 'zod'
import type { TFunction } from 'i18next'

export type AnnouncementStatus = 'draft' | 'published'

export type Announcement = {
  id: number
  title: string
  category: string
  content: string
  publishDate: string
  pinned: boolean
  status: AnnouncementStatus
}

/**
 * Computed lifecycle state for display:
 * - draft: saved but never shown to users
 * - scheduled: published but publishDate is still in the future
 * - published: published and publishDate has passed (visible to users)
 */
export type DisplayState = 'draft' | 'scheduled' | 'published'

export function getDisplayState(announcement: Announcement): DisplayState {
  if (announcement.status === 'draft') return 'draft'
  if (new Date(announcement.publishDate).getTime() > Date.now()) {
    return 'scheduled'
  }
  return 'published'
}

export function getAnnouncementSchema(t: TFunction) {
  return z.object({
    title: z
      .string()
      .min(1, t('Title is required'))
      .max(100, t('Title must be less than 100 characters')),
    category: z
      .string()
      .max(20, t('Category must be less than 20 characters')),
    content: z
      .string()
      .min(1, t('Content is required'))
      .max(2000, t('Content must be less than 2000 characters')),
    publishDate: z.string().min(1, t('Publish date is required')),
    status: z.enum(['draft', 'published']),
    pinned: z.boolean(),
  })
}

export type AnnouncementFormValues = z.infer<
  ReturnType<typeof getAnnouncementSchema>
>

/**
 * 解析 option 里的公告 JSON 数组字符串为规范化列表。
 * 向后兼容旧数据:缺 title/category/pinned 时补默认;缺 status 视为已发布。
 */
export function parseAnnouncements(data: string): Announcement[] {
  try {
    const parsed = JSON.parse(data || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map((item, idx) => ({
      id: item.id || idx + 1,
      title: item.title ?? '',
      category: item.category ?? '',
      content: item.content ?? '',
      publishDate: item.publishDate ?? new Date().toISOString(),
      pinned: item.pinned === true,
      status: item.status === 'draft' ? 'draft' : 'published',
    }))
  } catch {
    return []
  }
}
