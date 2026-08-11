/*
Copyright (C) 2023-2026 TierFlow
*/
'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Card-in-card container for tables (and other bordered content). Wrapping a
 * {@link Table} in a `Frame` activates its `in-data-[slot=frame]:*` variants,
 * producing the rounded, separated-border "Console" list look: a muted padding
 * ring around a `bg-background` grid with rounded outer corners.
 *
 * ```tsx
 * <Frame>
 *   <Table>…</Table>
 * </Frame>
 * ```
 */
function Frame({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='frame'
      className={cn(
        'relative flex flex-col rounded-2xl bg-muted/72 p-1',
        className
      )}
      {...props}
    />
  )
}

export { Frame }
