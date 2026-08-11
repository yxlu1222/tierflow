/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, type ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button, type buttonVariants } from '@/components/ui/button'
import type { VariantProps } from 'class-variance-authority'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

// ============================================================================
// Filter Popover — 收纳筛选条件的「筛选」按钮 + 弹层
//
// 触发按钮在有已选条件时高亮并显示计数徽标。仅封装这一层交互:各表格的
// 筛选字段布局、移动端策略差异较大,由各自的工具栏负责。
// ============================================================================

export function FilterPopover({
  count,
  children,
  contentClassName,
  gridClassName,
  size,
}: {
  /** 已选条件数;> 0 时高亮触发按钮并显示徽标 */
  count: number
  /** 弹层内的筛选字段 */
  children: ReactNode
  /** 弹层宽度等样式覆盖 */
  contentClassName?: string
  /** 字段容器的栅格样式,字段较多时可传两列 */
  gridClassName?: string
  /**
   * 触发按钮尺寸。默认沿用 Button 的 default,与各表格工具栏现有观感一致;
   * 页面级工具栏(如看板的活动日志)传 'pill' 与同行的其它动作按钮对齐。
   */
  size?: VariantProps<typeof buttonVariants>['size']
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            size={size}
            className={cn(
              'gap-1.5',
              count > 0 && 'border-primary/40 text-primary hover:text-primary'
            )}
          />
        }
      >
        <SlidersHorizontal className='size-4' />
        {t('Filter')}
        {count > 0 && (
          <Badge className='ml-0.5 size-5 justify-center p-0 text-[10px]'>
            {count}
          </Badge>
        )}
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className={cn('w-[min(320px,calc(100vw-2rem))] p-3', contentClassName)}
      >
        <div className={cn('grid gap-2', gridClassName)}>{children}</div>
      </PopoverContent>
    </Popover>
  )
}
