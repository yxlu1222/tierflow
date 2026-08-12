/*
Copyright (C) 2023-2026 TierFlow
*/
import { Fragment } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Mail, Phone } from 'lucide-react'
import { DEFAULT_SYSTEM_NAME, DEFAULT_LOGO, DOCS_URL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useSystemConfig } from '@/hooks/use-system-config'

interface FooterProps {
  logo?: string
  name?: string
  copyright?: string
  className?: string
}

const CONTACT_EMAIL = 'contact@tierflow.ai'
const CONTACT_PHONE = '+86 400-000-0000'

// 内部路由(TanStack 类型化 Link)与外链分开定义,避免给不存在的路由传 `to`。
const PRODUCT_INTERNAL: { label: string; to: string }[] = [
  { label: '一体机首页', to: '/usage' },
]
const PRODUCT_EXTERNAL: { label: string; href: string }[] = [
  { label: '接入文档', href: DOCS_URL },
]
const COMPANY_LINKS: { label: string; to: string }[] = [
  { label: '关于我们', to: '/about' },
  { label: '首页', to: '/' },
]
const LEGAL_LINKS: { label: string; to: string }[] = [
  { label: '用户协议', to: '/user-agreement' },
  { label: '隐私政策', to: '/privacy-policy' },
]

// 页脚固定深色主题(不随 App 亮/暗主题翻转),故用固定的白色透明度而非 token。
const linkCls =
  'text-white/60 hover:text-white text-sm transition-colors duration-200'

function ColHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className='mb-4 text-[13px] font-semibold tracking-wide text-white'>
      {children}
    </h3>
  )
}

export function Footer(props: FooterProps) {
  const { systemName, logo: systemLogo } = useSystemConfig()

  const displayLogo = systemLogo || props.logo || DEFAULT_LOGO
  const displayName = systemName || props.name || DEFAULT_SYSTEM_NAME
  const currentYear = new Date().getFullYear()

  return (
    <footer
      className={cn(
        'relative z-10 border-t border-white/10 bg-[#0c0d0f] text-white',
        props.className
      )}
    >
      <div className='mx-auto w-full max-w-[1120px] px-[clamp(20px,4vw,40px)] pt-16 pb-8'>
        {/* 顶部:品牌块 + 链接列 */}
        <div className='grid grid-cols-1 gap-x-8 gap-y-10 md:grid-cols-12'>
          {/* 品牌 */}
          <div className='md:col-span-5'>
            <Link to='/' className='inline-flex items-center gap-2.5'>
              <img
                src={displayLogo}
                alt={displayName}
                className='size-7 rounded-lg object-contain'
              />
              <span className='text-lg font-semibold tracking-tight text-white'>
                {displayName}
              </span>
            </Link>
            <p className='mt-4 max-w-xs text-sm leading-relaxed text-white/55'>
              让你的 Agent 在每一步都用最合适的模型。不浪费,不妥协。
            </p>
          </div>

          {/* 产品 */}
          <div className='md:col-span-3'>
            <ColHeading>产品</ColHeading>
            <ul className='space-y-3'>
              {PRODUCT_INTERNAL.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
              {PRODUCT_EXTERNAL.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    className={cn(linkCls, 'inline-flex items-center gap-1')}
                  >
                    {l.label}
                    <ArrowUpRight className='size-3.5' strokeWidth={1.6} />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* 公司 */}
          <div className='md:col-span-2'>
            <ColHeading>公司</ColHeading>
            <ul className='space-y-3'>
              {COMPANY_LINKS.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className={linkCls}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* 联系 */}
          <div className='md:col-span-2'>
            <ColHeading>联系</ColHeading>
            <ul className='space-y-3'>
              <li>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  className={cn(linkCls, 'inline-flex items-center gap-2')}
                >
                  <Mail className='size-4 shrink-0' strokeWidth={1.5} />
                  {CONTACT_EMAIL}
                </a>
              </li>
              <li className='inline-flex items-center gap-2 text-sm text-white/60'>
                <Phone className='size-4 shrink-0' strokeWidth={1.5} />
                <span className='whitespace-nowrap'>{CONTACT_PHONE}</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 巨型品牌字标(参考 MiniMax 关于页页脚风格) */}
        <div
          aria-hidden='true'
          className='pointer-events-none mt-14 overflow-hidden select-none'
        >
          <span className='block text-[clamp(56px,14vw,184px)] leading-[0.9] font-bold tracking-tight text-white/[0.06]'>
            {displayName}
          </span>
        </div>

        {/* 底部:版权 + 法律 */}
        <div className='mt-6 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between'>
          <span>
            &copy; {currentYear} {displayName} · 保留所有权利
          </span>
          <div className='flex items-center gap-4'>
            {LEGAL_LINKS.map((item, index) => (
              <Fragment key={item.to}>
                {index > 0 && (
                  <span aria-hidden='true' className='text-white/25'>
                    ·
                  </span>
                )}
                <Link
                  to={item.to}
                  className='text-white/55 transition-colors duration-200 hover:text-white'
                >
                  {item.label}
                </Link>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
