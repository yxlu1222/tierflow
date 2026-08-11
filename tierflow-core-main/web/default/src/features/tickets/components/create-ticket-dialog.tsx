/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createTicket } from '../api'
import {
  TICKET_CATEGORY,
  TICKET_CATEGORIES,
  TICKET_CATEGORY_VALUES,
  TICKET_MESSAGES,
  TICKET_PRIORITY,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_VALUES,
  type TicketCategory,
  type TicketPriority,
} from '../constants'
import { ticketsQueryKeys } from '../lib/query-keys'

interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function FieldLabel({
  children,
  required,
}: {
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <label className='mb-1.5 block text-[13px] font-medium'>
      {children}
      {required && <span className='text-destructive'> *</span>}
    </label>
  )
}

/**
 * 「问题反馈」弹窗：不复用项目通用 Dialog，按原型自绘遮罩 + 卡片，
 * 对齐参考图的圆角 / 间距 / 说明文案 / 必填标记 / 全宽提交按钮。
 */
export function CreateTicketDialog({
  open,
  onOpenChange,
}: CreateTicketDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TicketCategory>(
    TICKET_CATEGORY.TECHNICAL
  )
  const [priority, setPriority] = useState<TicketPriority>(
    TICKET_PRIORITY.MEDIUM
  )
  const [content, setContent] = useState('')

  const reset = () => {
    setTitle('')
    setCategory(TICKET_CATEGORY.TECHNICAL)
    setPriority(TICKET_PRIORITY.MEDIUM)
    setContent('')
  }

  const mutation = useMutation({
    mutationFn: () =>
      createTicket({
        title: title.trim(),
        category,
        priority,
        content: content.trim(),
      }),
    onSuccess: (res) => {
      if (!res.success) return
      toast.success(t(TICKET_MESSAGES.CREATE_SUCCESS))
      queryClient.invalidateQueries({ queryKey: ticketsQueryKeys.lists() })
      reset()
      onOpenChange(false)
    },
  })

  // 打开时锁滚动 + Esc 关闭。
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  if (!open) return null

  const canSubmit = title.trim().length > 0 && content.trim().length > 0

  return createPortal(
    <div
      className='animate-in fade-in-0 fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 duration-150'
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-label={t('Problem Feedback')}
        className='bg-card animate-in zoom-in-95 fade-in-0 max-h-[90vh] w-full max-w-[460px] overflow-y-auto rounded-2xl border p-6 shadow-2xl duration-200'
      >
        <div className='mb-1.5 flex items-start justify-between gap-3'>
          <h3 className='text-lg font-semibold'>{t('Problem Feedback')}</h3>
          <button
            type='button'
            aria-label={t('Close')}
            onClick={() => onOpenChange(false)}
            className='text-muted-foreground hover:bg-muted hover:text-foreground -mt-1 -mr-1 rounded-md p-1.5'
          >
            <X className='size-4' />
          </button>
        </div>
        <p className='text-muted-foreground mb-5 text-sm leading-relaxed'>
          {t(
            'Describe your issue and we will reply in your ticket records — no contact info needed.'
          )}
        </p>

        <div className='mb-3.5 grid grid-cols-2 gap-3'>
          <div>
            <FieldLabel>{t('Category')}</FieldLabel>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as TicketCategory)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue>
                  {t(TICKET_CATEGORIES[category].labelKey)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TICKET_CATEGORY_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(TICKET_CATEGORIES[v].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <FieldLabel>{t('Priority')}</FieldLabel>
            <Select
              value={priority}
              onValueChange={(v) => setPriority(v as TicketPriority)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue>
                  {t(TICKET_PRIORITIES[priority].labelKey)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TICKET_PRIORITY_VALUES.map((v) => (
                  <SelectItem key={v} value={v}>
                    {t(TICKET_PRIORITIES[v].labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className='mb-3.5'>
          <FieldLabel required>{t('Subject')}</FieldLabel>
          <Input
            value={title}
            maxLength={255}
            placeholder={t('Briefly summarize the issue')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className='mb-5'>
          <FieldLabel required>{t('Description')}</FieldLabel>
          <Textarea
            value={content}
            rows={6}
            className='min-h-[120px]'
            placeholder={t(
              'Describe the problem, steps to reproduce, or your request in detail'
            )}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <Button
          className='h-11 w-full text-sm'
          onClick={() => mutation.mutate()}
          disabled={!canSubmit || mutation.isPending}
        >
          {t('Submit Feedback')}
        </Button>
      </div>
    </div>,
    document.body
  )
}
