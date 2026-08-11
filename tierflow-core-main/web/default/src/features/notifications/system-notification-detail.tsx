/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo } from 'react'
import { ArrowLeft, CalendarClock, Pin } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getAnnouncementKey } from '@/hooks/use-notifications'
import { useNotificationStore } from '@/stores/notification-store'
import { useStatus } from '@/hooks/use-status'
import { formatDateTimeObject } from '@/lib/time'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/ui/markdown'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBadge } from '@/components/category-badge'
import { SectionPageLayout } from '@/components/layout'

interface AnnouncementItem {
  id?: number
  title?: string
  category?: string
  pinned?: boolean
  content?: string
  publishDate?: string | Date
}

/**
 * 用户侧「系统通知」详情页。数据来自 /api/status 的 announcements(后端已按
 * status/发布时间过滤),按路由 id 定位单条公告,进入即标记该条已读。
 */
export function SystemNotificationDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const { status, loading } = useStatus()
  const { markAnnouncementsRead } = useNotificationStore()
  const numId = Number(id)

  const item = useMemo(
    () =>
      ((status?.announcements ?? []) as AnnouncementItem[]).find(
        (a) => a.id === numId
      ),
    [status, numId]
  )

  useEffect(() => {
    if (item) markAnnouncementsRead([getAnnouncementKey(item)])
  }, [item, markAnnouncementsRead])

  const backButton = (
    <Button
      variant='outline'
      size='sm'
      render={<Link to='/notifications/system' />}
    >
      <ArrowLeft className='size-4' />
      {t('Back')}
    </Button>
  )

  const publishedAt =
    item?.publishDate && formatDateTimeObject(new Date(item.publishDate))

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Announcement')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>{backButton}</SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {loading ? (
          <div className='mx-auto w-full max-w-3xl'>
            <Skeleton className='h-96 w-full rounded-2xl' />
          </div>
        ) : !item ? (
          <div className='bg-card text-muted-foreground mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center text-sm shadow-xs'>
            {t('Announcement not found')}
            {backButton}
          </div>
        ) : (
          <article className='bg-card mx-auto w-full max-w-3xl overflow-hidden rounded-2xl border shadow-xs'>
            <header className='flex flex-col gap-4 border-b px-6 py-7 sm:px-10 sm:py-9'>
              {item.category || item.pinned ? (
                <div className='flex flex-wrap items-center gap-2'>
                  {item.pinned ? (
                    <span className='text-primary inline-flex items-center gap-1 text-xs font-medium'>
                      <Pin className='size-3.5 fill-current' />
                      {t('Pinned')}
                    </span>
                  ) : null}
                  <CategoryBadge category={item.category} />
                </div>
              ) : null}
              <h1 className='text-foreground text-2xl leading-tight font-semibold tracking-tight text-balance sm:text-3xl'>
                {item.title?.trim() || t('Announcement')}
              </h1>
              {publishedAt ? (
                <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
                  <CalendarClock className='size-3.5 shrink-0' />
                  <time className='tabular-nums'>{publishedAt}</time>
                </div>
              ) : null}
            </header>
            <div className='px-6 py-7 sm:px-10 sm:py-9'>
              <Markdown>{item.content || ''}</Markdown>
            </div>
          </article>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
