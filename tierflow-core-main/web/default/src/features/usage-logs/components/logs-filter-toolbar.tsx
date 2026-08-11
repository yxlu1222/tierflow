/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, type ComponentProps, type ReactNode } from 'react'
import { type Table } from '@tanstack/react-table'
import { useMediaQuery } from '@/hooks'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FilterPopover } from '@/components/data-table'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'

interface LogsFilterToolbarProps<TData> {
  table: Table<TData>
  /** 左侧标题区(桌面端占据 primaryFilters 腾出来的位置)。 */
  leading?: ReactNode
  /**
   * 常驻可见的筛选控件(日期区间)。桌面端渲染在右侧操作区、「筛选」按钮左边 ——
   * 它和筛选/重置是同一类操作,聚在一起比散在两端好扫。
   */
  primaryFilters: ReactNode
  advancedFilters?: ReactNode
  mobilePinnedFilters?: ReactNode
  mobileFilters?: ReactNode
  mobileFilterCount?: number
  stats?: ReactNode
  hasActiveFilters: boolean
  hasAdvancedActiveFilters?: boolean
  advancedFilterCount?: number
  searchLoading?: boolean
  onReset: () => void
  onSearch: () => void
  className?: string
}

interface LogsFilterFieldProps {
  children: ReactNode
  wide?: boolean
  className?: string
}

export function LogsFilterField(props: LogsFilterFieldProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center [&_[data-slot=select-trigger]]:w-full [&_[data-slot=select-trigger]]:text-sm [&_[data-slot=select-value]]:leading-5',
        props.wide && 'sm:col-span-2',
        props.className
      )}
    >
      {props.children}
    </div>
  )
}

export function LogsFilterInput(props: ComponentProps<typeof Input>) {
  return (
    <Input
      {...props}
      className={cn('h-8 min-w-0 text-sm leading-5', props.className)}
    />
  )
}

export function LogsFilterToolbar<TData>(props: LogsFilterToolbarProps<TData>) {
  const { t } = useTranslation()
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const isMobile = useMediaQuery('(max-width: 640px)')

  const hasAdvancedFilters = props.advancedFilters != null
  const activeAdvancedCount =
    props.advancedFilterCount ?? (props.hasAdvancedActiveFilters ? 1 : 0)
  const activeMobileFilterCount = props.mobileFilterCount ?? activeAdvancedCount

  const handleMobileReset = () => {
    props.onReset()
    setMobileFiltersOpen(false)
  }

  const handleMobileSearch = () => {
    props.onSearch()
    setMobileFiltersOpen(false)
  }

  if (isMobile && props.mobilePinnedFilters != null) {
    return (
      <Drawer open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <div
          className={cn('bg-card/50 rounded-lg border p-2.5', props.className)}
        >
          {/* 移动端同样要有标题:表格会塌成卡片列表,没有标题就和上面的 KPI
              卡连成一片,看不出这里换了一个区块 */}
          {props.leading && <div className='mb-2.5'>{props.leading}</div>}
          <div className='grid gap-2'>{props.mobilePinnedFilters}</div>

          <div className='mt-2 flex flex-col gap-2'>
            {props.stats}
            <div className='flex items-center justify-end gap-1.5'>
              <DrawerTrigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  className={cn(
                    'text-muted-foreground hover:text-foreground gap-1 px-2',
                    activeMobileFilterCount > 0 &&
                      'text-primary hover:text-primary'
                  )}
                >
                  {t('Filter')}
                  {activeMobileFilterCount > 0 && (
                    <Badge className='ml-0.5 size-5 justify-center p-0 text-[10px]'>
                      {activeMobileFilterCount}
                    </Badge>
                  )}
                </Button>
              </DrawerTrigger>
              <Button
                type='button'
                onClick={props.onSearch}
                disabled={props.searchLoading}
              >
                {props.searchLoading && <Loader2 className='animate-spin' />}
                {t('Search')}
              </Button>
            </div>
          </div>
        </div>

        <DrawerContent className='max-h-[85dvh] p-0'>
          <div className='mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden'>
            <DrawerHeader className='border-border/70 border-b px-4 py-3 text-left'>
              <DrawerTitle>{t('Filter')}</DrawerTitle>
              <DrawerDescription>
                {t('Adjust filters, then search to refresh the logs.')}
              </DrawerDescription>
            </DrawerHeader>
            <div className='flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-3'>
              {props.mobileFilters ?? (
                <>
                  {props.primaryFilters}
                  {props.advancedFilters}
                </>
              )}
            </div>
            <DrawerFooter className='border-border/70 grid grid-cols-2 gap-2 border-t px-4 py-3'>
              <Button
                type='button'
                variant='outline'
                onClick={handleMobileReset}
                disabled={!props.hasActiveFilters}
              >
                {t('Reset')}
              </Button>
              <Button
                type='button'
                onClick={handleMobileSearch}
                disabled={props.searchLoading}
              >
                {props.searchLoading && <Loader2 className='animate-spin' />}
                {t('Search')}
              </Button>
            </DrawerFooter>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-2 px-2 py-2',
        props.className
      )}
    >
      {/* 左侧:标题区。撑开 flex-1 把右边的操作簇顶到行尾。 */}
      <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
        {props.leading}
      </div>

      {/* 右侧操作簇 —— 日期区间、筛选弹层、重置。筛选改动即时生效,没有搜索按钮。 */}
      <div className='flex flex-wrap items-center justify-end gap-1.5 sm:gap-2'>
        {props.searchLoading && (
          <Loader2 className='text-muted-foreground size-4 animate-spin' />
        )}

        {props.primaryFilters}

        {/* 日期区间、筛选、重置同属页面级工具栏动作,统一用 pill 尺寸 */}
        {hasAdvancedFilters && (
          <FilterPopover count={activeAdvancedCount} size='pill'>
            {props.advancedFilters}
          </FilterPopover>
        )}

        <Button
          type='button'
          variant='outline'
          size='pill'
          onClick={props.onReset}
          disabled={!props.hasActiveFilters}
        >
          {t('Reset')}
        </Button>
      </div>
    </div>
  )
}
