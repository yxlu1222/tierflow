/*
Copyright (C) 2023-2026 TierFlow
*/
import { cn } from '@/lib/utils'

type HeaderProps = React.HTMLAttributes<HTMLElement>

export function Header({ className, children, ...props }: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 h-[var(--app-header-height,4rem)] w-full shrink-0 bg-transparent',
        className
      )}
      {...props}
    >
      <div className='flex h-full items-center gap-1.5 px-2 sm:gap-2 sm:px-3'>
        {children}
      </div>
    </header>
  )
}
