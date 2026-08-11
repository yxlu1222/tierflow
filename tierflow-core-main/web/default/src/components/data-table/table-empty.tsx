/*
Copyright (C) 2023-2026 TierFlow
*/
import { Database } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { TableRow, TableCell } from '@/components/ui/table'

interface TableEmptyProps {
  /**
   * Number of columns to span
   */
  colSpan: number
  /**
   * Custom title for empty state
   * @default 'No Data'
   */
  title?: string
  /**
   * Custom description for empty state
   * @default 'No records found. Try adjusting your filters.'
   */
  description?: string
  /**
   * Custom icon component
   * @default Database icon
   */
  icon?: React.ReactNode
  /**
   * Additional content to display (e.g., buttons)
   */
  children?: React.ReactNode
}

/**
 * Generic table empty state component
 * Displays a centered empty state message when table has no data
 */
export function TableEmpty({
  colSpan,
  title,
  description,
  icon,
  children,
}: TableEmptyProps) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('No Data')
  // `undefined` → default copy; `null`/`''` → omit the description entirely.
  const resolvedDescription =
    description === undefined
      ? t('No records found. Try adjusting your filters.')
      : description
  // `null` explicitly suppresses the icon; `undefined` falls back to the default.
  const showIcon = icon !== null

  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell colSpan={colSpan} className='h-[400px] p-0'>
        <Empty>
          <EmptyHeader>
            {showIcon && (
              <EmptyMedia variant='icon'>
                {icon ?? <Database className='size-6' />}
              </EmptyMedia>
            )}
            <EmptyTitle>{resolvedTitle}</EmptyTitle>
            {resolvedDescription ? (
              <EmptyDescription>{resolvedDescription}</EmptyDescription>
            ) : null}
          </EmptyHeader>
          {children}
        </Empty>
      </TableCell>
    </TableRow>
  )
}
