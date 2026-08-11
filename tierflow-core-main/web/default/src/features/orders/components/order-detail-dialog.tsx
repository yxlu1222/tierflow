/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface OrderDetailField {
  label: string
  value: ReactNode
  /** 长文本(如回调原文)整行展示,不并排 */
  block?: boolean
}

interface OrderDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fields: OrderDetailField[]
}

export function OrderDetailDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
}: OrderDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <dl className='divide-border divide-y text-sm'>
          {fields.map((field) =>
            field.block ? (
              <div key={field.label} className='py-2'>
                <dt className='text-muted-foreground mb-1'>{field.label}</dt>
                <dd className='bg-muted max-h-40 overflow-auto rounded-md p-2 break-all whitespace-pre-wrap tabular-nums'>
                  {field.value}
                </dd>
              </div>
            ) : (
              <div
                key={field.label}
                className='flex items-start justify-between gap-4 py-2'
              >
                <dt className='text-muted-foreground shrink-0'>
                  {field.label}
                </dt>
                <dd className='text-right break-all tabular-nums'>
                  {field.value}
                </dd>
              </div>
            )
          )}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
