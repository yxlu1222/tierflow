/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { type Row } from '@tanstack/react-table'
import { Link } from '@tanstack/react-router'
import {
  Edit,
  Pin,
  PinOff,
  Send,
  Trash2,
  Undo2,
  MoreHorizontal as DotsHorizontalIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAnnouncementsData } from '../use-announcements-data'
import { type Announcement } from '../types'

export function AnnouncementsRowActions({ row }: { row: Row<Announcement> }) {
  const { t } = useTranslation()
  const announcement = row.original
  const { togglePin, toggleStatus, remove, isPending } = useAnnouncementsData()
  const isPublished = announcement.status === 'published'
  const [showDelete, setShowDelete] = useState(false)

  const confirmDelete = async () => {
    try {
      await remove(announcement)
      setShowDelete(false)
    } catch {
      toast.error(t('Failed to save announcements'))
    }
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              variant='ghost'
              className='data-popup-open:bg-muted flex h-8 w-8 p-0'
            />
          }
        >
          <DotsHorizontalIcon className='h-4 w-4' />
          <span className='sr-only'>{t('Open menu')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-[160px]'>
          <DropdownMenuItem
            render={
              <Link
                to='/announcements/$id/edit'
                params={{ id: String(announcement.id) }}
              />
            }
          >
            {t('Edit')}
            <DropdownMenuShortcut>
              <Edit size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => toggleStatus(announcement)}
            disabled={isPending}
          >
            {isPublished ? t('Withdraw') : t('Publish')}
            <DropdownMenuShortcut>
              {isPublished ? <Undo2 size={16} /> : <Send size={16} />}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => togglePin(announcement)}
            disabled={isPending}
          >
            {announcement.pinned ? t('Unpin') : t('Pin')}
            <DropdownMenuShortcut>
              {announcement.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setShowDelete(true)}
            disabled={isPending}
            className='text-destructive focus:text-destructive'
          >
            {t('Delete')}
            <DropdownMenuShortcut>
              <Trash2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Announcement')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This announcement will be permanently deleted. This action cannot be undone.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isPending}
              className='bg-destructive text-white hover:bg-destructive/90'
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
