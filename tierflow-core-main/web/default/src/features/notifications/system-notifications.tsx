/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import { ChevronRight, Megaphone, Pin } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getAnnouncementKey } from '@/hooks/use-notifications'
import { useNotificationStore } from '@/stores/notification-store'
import { useStatus } from '@/hooks/use-status'
import { formatDateTimeObject } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { CategoryBadge } from '@/components/category-badge'
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { SectionPageLayout } from '@/components/layout'

const PAGE_SIZE = 10

interface AnnouncementItem {
  id?: number
  title?: string
  category?: string
  pinned?: boolean
  content?: string
  publishDate?: string | Date
}

/** 公告发布时间戳(用于排序);缺省为 0 排到最后。 */
function announcementTimestamp(item: AnnouncementItem): number {
  if (!item.publishDate) return 0
  const ms = new Date(item.publishDate).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function announcementTime(item: AnnouncementItem): string {
  return item.publishDate ? formatDateTimeObject(new Date(item.publishDate)) : ''
}

/** 列表行摘要:取首行非空文本,剥掉 markdown 标题/列表前缀。 */
function announcementPreview(content?: string): string {
  const raw = (content || '').trim()
  if (!raw) return ''
  const firstLine = raw.split('\n').map((s) => s.trim()).find(Boolean) || raw
  return firstLine.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '')
}

/**
 * 系统通知页 —— 无头列表:一页固定 10 条,按时间倒序(最新在前),分页浏览。
 * 点击某条进入公告详情页(/notifications/system/$id)。数据来自 /api/status 的
 * announcements。逐条已读:点开某条时标记该条已读,列表区分已读/未读。
 */
export function SystemNotifications() {
  const { t } = useTranslation()
  const { markAnnouncementsRead, isAnnouncementRead } = useNotificationStore()
  const { status, loading } = useStatus()
  const [page, setPage] = useState(0)

  const items = useMemo(() => {
    // 公告面板恒常启用;后端已按 status/发布时间过滤并置顶优先。
    const list = (status?.announcements ?? []) as AnnouncementItem[]
    // 置顶优先,再按发布时间倒序。
    return [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return announcementTimestamp(b) - announcementTimestamp(a)
    })
  }, [status])

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const pageItems = items.slice(
    current * PAGE_SIZE,
    current * PAGE_SIZE + PAGE_SIZE
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('System Notifications')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        {loading ? (
          <Skeleton className='h-96 w-full rounded-2xl' />
        ) : items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className='flex flex-col gap-4'>
            {/* 无头列表:白卡内分隔行,整行可点,跳转到公告详情页。 */}
            <div className='bg-card divide-border/60 overflow-hidden rounded-2xl shadow-xs divide-y'>
              {pageItems.map((item, idx) => {
                const read = isAnnouncementRead(getAnnouncementKey(item))
                const preview = announcementPreview(item.content)
                return (
                  <Link
                    key={item.id ?? `${current}-${idx}`}
                    to='/notifications/system/$id'
                    params={{ id: String(item.id ?? '') }}
                    onClick={() =>
                      markAnnouncementsRead([getAnnouncementKey(item)])
                    }
                    className='hover:bg-muted/50 group flex w-full items-start gap-3 px-4 py-5 text-left transition-colors sm:gap-4 sm:px-6'
                  >
                    <span className='mt-1.5 flex shrink-0 items-center gap-2'>
                      {item.pinned && (
                        <Pin className='text-primary size-4 fill-current' />
                      )}
                      {!read && (
                        <span
                          className='bg-primary size-2.5 rounded-full'
                          aria-label={t('Unread')}
                        />
                      )}
                    </span>
                    <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <span
                          className={cn(
                            'text-foreground min-w-0 truncate text-base',
                            read ? 'font-normal' : 'font-semibold'
                          )}
                        >
                          {item.title?.trim() || preview || t('Announcement')}
                        </span>
                        <CategoryBadge category={item.category} />
                      </div>
                      <time className='text-muted-foreground/70 text-xs tabular-nums'>
                        {announcementTime(item)}
                      </time>
                    </div>
                    <ChevronRight className='text-muted-foreground/40 group-hover:text-muted-foreground mt-1 size-5 shrink-0 transition-colors' />
                  </Link>
                )
              })}
            </div>

            {pageCount > 1 && (
              <ListPagination
                page={current}
                pageCount={pageCount}
                onChange={setPage}
              />
            )}
          </div>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function ListPagination({
  page,
  pageCount,
  onChange,
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const atFirst = page === 0
  const atLast = page === pageCount - 1

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            text={t('Previous Page')}
            className={cn(atFirst && 'pointer-events-none opacity-50')}
            onClick={(e) => {
              e.preventDefault()
              if (!atFirst) onChange(page - 1)
            }}
          />
        </PaginationItem>
        {Array.from({ length: pageCount }).map((_, i) => (
          <PaginationItem key={i}>
            <PaginationLink
              isActive={i === page}
              onClick={(e) => {
                e.preventDefault()
                onChange(i)
              }}
            >
              {i + 1}
            </PaginationLink>
          </PaginationItem>
        ))}
        <PaginationItem>
          <PaginationNext
            text={t('Next Page')}
            className={cn(atLast && 'pointer-events-none opacity-50')}
            onClick={(e) => {
              e.preventDefault()
              if (!atLast) onChange(page + 1)
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className='bg-card text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-16 text-center shadow-xs'>
      <Megaphone className='size-6 opacity-50' />
      <p className='text-sm font-medium'>{t('No system announcements')}</p>
    </div>
  )
}
