/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ============================================================================
// Settings Card — 个人资料页的卡片语言
//
// 每个设置区块是一张独立卡片:卡片头为「标题 + 描述」,右上角可放主操作;
// 内容区是若干「图标 + 标签 + 值 + 行动作」的行。卡片之间靠间距分隔,
// 内部不使用分割线。
// ============================================================================

export function SettingsCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'bg-card rounded-2xl border p-5 shadow-xs sm:p-6',
        className
      )}
    >
      <div className='flex items-start justify-between gap-4'>
        <div className='min-w-0'>
          <h3 className='text-lg leading-none font-semibold tracking-tight'>
            {title}
          </h3>
          {description != null && (
            <p className='text-muted-foreground mt-2 text-sm'>{description}</p>
          )}
        </div>
        {action != null && <div className='shrink-0'>{action}</div>}
      </div>
      {children != null && <div className='mt-6'>{children}</div>}
    </section>
  )
}

/**
 * 卡片内的一行:可选图标 + 标签 + 值 + 右侧动作。
 * 值区占据剩余宽度,长内容截断而非撑破布局。
 */
export function SettingsRow({
  icon: Icon,
  label,
  value,
  action,
}: {
  icon?: ElementType<{ className?: string }>
  label: ReactNode
  value?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className='flex items-center gap-3 py-3 sm:gap-4'>
      {Icon != null && (
        <Icon className='text-muted-foreground size-[18px] shrink-0' />
      )}
      <span className='text-foreground shrink-0 text-[15px] font-medium'>
        {label}
      </span>
      <span className='text-muted-foreground min-w-0 flex-1 truncate text-[15px]'>
        {value}
      </span>
      {action != null && <div className='shrink-0'>{action}</div>}
    </div>
  )
}

/** 无图标的键值行,用于纯信息展示(标签左、值右)。 */
export function InfoRow({
  label,
  children,
  className,
}: {
  label: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className='flex items-baseline justify-between gap-4 py-3'>
      <span className='text-muted-foreground shrink-0 text-[15px]'>
        {label}
      </span>
      <span
        className={cn(
          'text-foreground min-w-0 truncate text-[15px]',
          className
        )}
      >
        {children}
      </span>
    </div>
  )
}
