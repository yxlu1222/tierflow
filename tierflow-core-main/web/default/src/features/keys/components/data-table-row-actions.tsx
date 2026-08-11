/*
Copyright (C) 2023-2026 TierFlow
*/
import { type Row } from '@tanstack/react-table'
import { Edit, Eye, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { apiKeySchema } from '../types'
import { useApiKeys } from './api-keys-provider'

type DataTableRowActionsProps<TData> = {
  row: Row<TData>
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const { t } = useTranslation()
  const apiKey = apiKeySchema.parse(row.original)
  const { setOpen, setCurrentRow } = useApiKeys()

  const open = (dialog: 'update' | 'delete' | 'detail') => {
    setCurrentRow(apiKey)
    setOpen(dialog)
  }

  return (
    <div className='flex items-center justify-start gap-0.5'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Edit')}
              onClick={() => open('update')}
            />
          }
        >
          <Edit className='size-4' />
        </TooltipTrigger>
        <TooltipContent>{t('Edit')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Delete')}
              className='text-destructive hover:text-destructive'
              onClick={() => open('delete')}
            />
          }
        >
          <Trash2 className='size-4' />
        </TooltipTrigger>
        <TooltipContent>{t('Delete')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('Details')}
              onClick={() => open('detail')}
            />
          }
        >
          <Eye className='size-4' />
        </TooltipTrigger>
        <TooltipContent>{t('Details')}</TooltipContent>
      </Tooltip>
    </div>
  )
}
