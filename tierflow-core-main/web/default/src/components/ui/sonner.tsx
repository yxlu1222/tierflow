/*
Copyright (C) 2023-2026 TierFlow
*/
'use client'

import {
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Alert02Icon,
  MultiplicationSignCircleIcon,
  Loading03Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme='light'
      className='toaster group'
      icons={{
        success: (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            strokeWidth={2}
            className='text-success size-4'
          />
        ),
        info: (
          <HugeiconsIcon
            icon={InformationCircleIcon}
            strokeWidth={2}
            className='text-info size-4'
          />
        ),
        warning: (
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className='text-warning size-4'
          />
        ),
        error: (
          <HugeiconsIcon
            icon={MultiplicationSignCircleIcon}
            strokeWidth={2}
            className='text-destructive size-4'
          />
        ),
        loading: (
          <HugeiconsIcon
            icon={Loading03Icon}
            strokeWidth={2}
            className='text-muted-foreground size-4 animate-spin'
          />
        ),
      }}
      toastOptions={{
        classNames: {
          // 统一白卡:标题加粗、描述转灰。整体「图标在上 + 文字居中」的布局
          // 与左色条一起放在 styles/index.css(需匹配 sonner 自带规则的特异性)。
          title: 'font-semibold',
          description: '!text-muted-foreground',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
