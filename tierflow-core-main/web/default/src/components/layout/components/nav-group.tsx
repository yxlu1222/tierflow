/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebar } from '@/components/ui/sidebar'
import { checkIsActive } from '../lib/url-utils'
import {
  type NavCollapsible,
  type NavLink,
  type NavGroup as NavGroupProps,
} from '../types'

/**
 * 侧边栏导航分组(视觉参考 dashboard-sidebar demo)。
 * 13px 紧凑行 + 子菜单缩进引导线 + grid 展开动画 + pill 徽标 + 大写小标题。
 * 数据/路由/激活态来自项目现有体系(注册表 + TanStack Router + checkIsActive),
 * 主题化(用设计 token,支持暗色)。侧栏已固定不折叠,无折叠态下拉分支。
 */
export function NavGroup({ title, items }: NavGroupProps) {
  const href = useLocation({ select: (location) => location.href })

  return (
    <div className='flex flex-col gap-0.5'>
      {title && (
        <span className='mb-1.5 flex min-w-0 items-center px-4 text-[14px] font-semibold text-[#181E25]'>
          <span className='truncate'>{title}</span>
        </span>
      )}
      {items.map((item) => {
        const key = `${item.title}-${item.url || item.type}`

        // 无子项:普通链接
        if (!item.items) {
          return <NavLeaf key={key} item={item as NavLink} href={href} />
        }

        // 可折叠:含子项
        return (
          <NavCollapsibleItem
            key={key}
            item={item as NavCollapsible}
            href={href}
          />
        )
      })}
    </div>
  )
}

/** pill 徽标 */
function NavBadge({ children }: { children: ReactNode }) {
  return (
    <span className='bg-primary/10 text-primary flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-medium'>
      {children}
    </span>
  )
}

const ROW_BASE =
  'group flex h-[40px] items-center justify-between rounded-[12px] px-3 transition-all duration-200 select-none'

/** 叶子链接项 */
function NavLeaf({
  item,
  href,
  level = 0,
}: {
  item: NavLink
  href: string
  level?: number
}) {
  const { setOpenMobile } = useSidebar()
  const isActive = checkIsActive(href, item)
  const Icon = item.icon

  return (
    <Link
      to={item.url}
      onClick={() => setOpenMobile(false)}
      // 有图标时左内边距收窄:图标本身已经提供了视觉起始位,再留 28px 会太靠右
      style={{ paddingLeft: `${level * 12 + (Icon ? 14 : 28)}px` }}
      className={cn(
        ROW_BASE,
        isActive
          ? 'text-foreground bg-black/5 font-medium'
          : 'text-muted-foreground hover:text-foreground/90 hover:bg-black/5'
      )}
    >
      <span className='flex min-w-0 items-center gap-2.5'>
        {Icon && (
          <Icon
            className={cn(
              'size-4 shrink-0',
              isActive ? 'text-foreground' : 'text-muted-foreground/70'
            )}
          />
        )}
        <span className='truncate text-[14px] leading-[19px] tracking-wide'>
          {item.title}
        </span>
      </span>
      {item.badge && <NavBadge>{item.badge}</NavBadge>}
    </Link>
  )
}

/** 可折叠分组项(缩进引导线 + grid 动画) */
function NavCollapsibleItem({
  item,
  href,
  level = 0,
}: {
  item: NavCollapsible
  href: string
  level?: number
}) {
  const isSubActive = checkIsActive(href, item)
  const [isOpen, setIsOpen] = useState(() => isSubActive)
  const Icon = item.icon

  // 路径命中子项时自动展开
  useEffect(() => {
    if (isSubActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsOpen(true)
    }
  }, [isSubActive])

  return (
    <div className='flex w-full flex-col'>
      <button
        type='button'
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        style={{ paddingLeft: `${level * 12 + (Icon ? 14 : 28)}px` }}
        className={cn(
          ROW_BASE,
          'text-muted-foreground hover:text-foreground/90 hover:bg-black/5'
        )}
      >
        <span className='flex min-w-0 items-center gap-2.5'>
          {Icon && <Icon className='text-muted-foreground/70 size-4 shrink-0' />}
          <span className='truncate text-[14px] leading-[19px] tracking-wide'>
            {item.title}
          </span>
        </span>
        <span className='flex items-center gap-2'>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
          <ChevronRight
            strokeWidth={2}
            className={cn(
              'text-muted-foreground/50 size-3.5 transition-transform duration-200',
              isOpen && 'rotate-90'
            )}
          />
        </span>
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out',
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className='relative mt-0.5 flex min-h-0 flex-col gap-0.5 overflow-hidden'>
          <div
            className='absolute top-0 bottom-0 border-l border-black/5'
            style={{ left: `${level * 12 + 33}px` }}
          />
          {item.items.map((sub) => (
            <NavLeaf
              key={sub.title}
              item={sub as NavLink}
              href={href}
              level={level + 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
