/*
Copyright (C) 2023-2026 TierFlow
*/
import { Plus } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export function AnnouncementsPrimaryButtons() {
  const { t } = useTranslation()
  return (
    <div className='flex gap-2'>
      <Button size='pill' render={<Link to='/announcements/new' />}>
        <Plus className='h-4 w-4' />
        {t('Add Announcement')}
      </Button>
    </div>
  )
}
