/*
Copyright (C) 2023-2026 TierFlow
*/
/* eslint-disable react-refresh/only-export-components -- 本文件有意集中导出营销页共用的常量 + 基元组件 */
/**
 * 落地页 / 营销页共用的品牌基元。所有颜色走 `.tf-landing` 作用域 token,
 * 因此这些组件必须渲染在带 `tf-landing` class 的容器内(首页、工作原理页、
 * 实测数据页均如此)。
 */

export { DOCS_URL } from '@/lib/constants'

// 容器:对齐参考稿 .container(max 1120px, 自适应内边距)
export const CONTAINER =
  'mx-auto w-full max-w-[1120px] px-[clamp(20px,4vw,40px)]'

export const DISPLAY = { fontFamily: 'var(--tf-display)' } as const

// 区块小标题眉(「NN / 文案」)—— 首页四个分区共用,别再各自内联一份 span
export function Eyebrow(props: { index: string; label: string }) {
  return (
    <span className='inline-flex items-center gap-2.5 text-[12px] font-medium tracking-[0.05em] text-[var(--tf-muted)]'>
      <b className='font-semibold text-[var(--tf-ink)]'>{props.index}</b> /{' '}
      {props.label}
    </span>
  )
}

export function ArrowIcon() {
  return (
    <svg
      aria-hidden='true'
      viewBox='0 0 24 24'
      fill='none'
      className='h-4 w-4 shrink-0'
      stroke='currentColor'
      strokeWidth={2}
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        d='M5 12h14m-6-6 6 6-6 6'
      />
    </svg>
  )
}

// 主按钮 / 次按钮 —— 对齐参考稿 .btn--primary / .btn--ghost
export function PrimaryButton(props: {
  children: React.ReactNode
  onClick?: () => void
  size?: 'lg'
}) {
  const h =
    props.size === 'lg'
      ? 'h-[50px] px-[26px] text-[15.5px] rounded-[11px]'
      : 'h-11 px-5 text-[14.5px] rounded-[10px]'
  return (
    <button
      type='button'
      onClick={props.onClick}
      className={`inline-flex items-center justify-center gap-2 border border-transparent bg-[var(--tf-btn)] font-medium whitespace-nowrap text-[var(--tf-btn-ink)] transition-[background,transform] duration-200 hover:-translate-y-px hover:bg-[var(--tf-btn-hover)] ${h}`}
    >
      {props.children}
    </button>
  )
}

export function GhostLink(props: {
  children: React.ReactNode
  href: string
  size?: 'lg'
}) {
  const h =
    props.size === 'lg'
      ? 'h-[50px] px-[26px] text-[15.5px] rounded-[11px]'
      : 'h-11 px-5 text-[14.5px] rounded-[10px]'
  return (
    <a
      href={props.href}
      target='_blank'
      rel='noopener noreferrer'
      className={`inline-flex items-center justify-center gap-2 border border-[var(--tf-line-2)] bg-[var(--tf-surface)] font-medium whitespace-nowrap text-[var(--tf-ink)] transition-colors duration-200 hover:border-[var(--tf-ink)] ${h}`}
    >
      {props.children}
    </a>
  )
}
