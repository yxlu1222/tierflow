/*
Copyright (C) 2023-2026 TierFlow
*/
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ErrorLayoutProps = {
  /** 大号状态码，传 undefined 则不显示（如 minimal 模式） */
  code?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** 标题/描述下方的小号补充说明 */
  hint?: React.ReactNode
  /** 底部按钮组，传 undefined 则不渲染 */
  actions?: React.ReactNode
  className?: string
}

/**
 * 全站异常页统一布局。
 * 视觉：品牌蓝柔光背景 + 前景色渐变大字重状态码 + 居中的标题/描述/按钮。
 * 404/403/401/500/503 共用，保证一致，避免各页重复复制结构。
 */
export function ErrorLayout({
  code,
  title,
  description,
  hint,
  actions,
  className,
}: ErrorLayoutProps) {
  return (
    <div
      className={cn(
        'relative flex min-h-svh w-full items-center justify-center overflow-hidden px-6 py-16',
        className
      )}
    >
      {/* 品牌蓝柔光，明暗主题各自适配 */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 flex items-center justify-center'
      >
        <div className='bg-primary/10 size-[34rem] max-w-full rounded-full blur-[120px]' />
      </div>

      <div className='relative z-10 flex w-full max-w-md flex-col items-center text-center'>
        {code != null && (
          <span
            className={cn(
              'from-foreground to-foreground/35 bg-gradient-to-b bg-clip-text',
              'text-[6rem] leading-none font-semibold tracking-tighter text-transparent tabular-nums select-none sm:text-[8rem]'
            )}
          >
            {code}
          </span>
        )}
        <h1
          className={cn(
            'text-foreground text-xl font-semibold tracking-tight sm:text-2xl',
            code != null && 'mt-6'
          )}
        >
          {title}
        </h1>
        {description && (
          <p className='text-muted-foreground mt-3 text-sm leading-relaxed sm:text-base'>
            {description}
          </p>
        )}
        {hint && (
          <p className='text-muted-foreground/70 mt-2 text-xs'>{hint}</p>
        )}
        {actions && (
          <div className='mt-8 flex flex-wrap items-center justify-center gap-3'>
            {actions}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 异常页按钮统一尺度：比后台默认按钮更舒展，贴合公众面页面的观感。
 * 两个按钮等宽（min-w），排在一起更整齐。
 */
const errorActionClass =
  'h-11 min-w-[132px] rounded-xl px-6 text-[15px] font-medium'

/** 返回上一页按钮，异常页通用。 */
export function GoBackButton() {
  const { t } = useTranslation()
  const { history } = useRouter()
  return (
    <Button
      variant='outline'
      className={errorActionClass}
      onClick={() => history.go(-1)}
    >
      {t('Go Back')}
    </Button>
  )
}

/** 回首页按钮，异常页通用。 */
export function BackToHomeButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <Button className={errorActionClass} onClick={() => navigate({ to: '/' })}>
      {t('Back to Home')}
    </Button>
  )
}
