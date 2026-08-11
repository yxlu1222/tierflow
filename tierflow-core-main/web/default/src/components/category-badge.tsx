/*
Copyright (C) 2023-2026 TierFlow
*/
import { getAvatarColorClass } from '@/lib/colors'
import { cn } from '@/lib/utils'

/**
 * Filled capsule for an announcement category / type. The background + text
 * color are derived from the category name (via `getAvatarColorClass`), so the
 * same type always renders in the same soft-tinted color across the app.
 */
export function CategoryBadge({
  category,
  className,
}: {
  category?: string
  className?: string
}) {
  const value = category?.trim()
  if (!value) return null
  return (
    <span
      className={cn(
        'inline-flex w-fit max-w-full shrink-0 items-center truncate rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        getAvatarColorClass(value),
        className
      )}
    >
      {value}
    </span>
  )
}
