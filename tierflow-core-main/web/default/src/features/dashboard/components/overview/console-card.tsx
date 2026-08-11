/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface ConsoleCardProps {
  title: ReactNode
  caption?: ReactNode
  actions?: ReactNode
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  /** Placeholder height for the loading / empty states (e.g. "192px"). */
  contentHeight?: string
  contentClassName?: string
  className?: string
  children?: ReactNode
}

/**
 * The Console-scheme card frame from the redesign prototype (`.card`):
 * 14px radius, uniform 17px padding, a 14px-title heading with a 12px caption,
 * optional right-aligned header actions, plus matching loading / empty states.
 */
export function ConsoleCard(props: ConsoleCardProps) {
  const { t } = useTranslation()
  const contentHeight = props.contentHeight ?? '176px'

  let body: ReactNode
  if (props.loading) {
    body = (
      <Skeleton
        className='w-full rounded-lg'
        style={{ height: contentHeight }}
      />
    )
  } else if (props.empty) {
    body = (
      <div
        className='text-muted-foreground flex items-center justify-center text-sm'
        style={{ height: contentHeight }}
      >
        {props.emptyMessage ?? t('No data available')}
      </div>
    )
  } else {
    body = props.children
  }

  return (
    <section
      className={cn(
        'flex flex-col rounded-[14px] bg-white p-[17px]',
        props.className
      )}
    >
      <div className='flex items-center justify-between gap-2'>
        <h3 className='text-[14px] leading-tight font-semibold tracking-tight'>
          {props.title}
        </h3>
        {props.actions}
      </div>
      {props.caption != null && (
        <p className='text-muted-foreground mt-1 text-xs'>{props.caption}</p>
      )}
      <div className={cn('mt-3.5 min-h-0 flex-1', props.contentClassName)}>
        {body}
      </div>
    </section>
  )
}
