/*
Copyright (C) 2023-2026 TierFlow
*/
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { MOTION_TRANSITION, MOTION_VARIANTS } from '@/lib/motion'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import { Sidebar, SidebarContent } from '@/components/ui/sidebar'
import { NavGroup } from './nav-group'
import { SidebarViewHeader } from './sidebar-view-header'

/**
 * Application sidebar.
 *
 * Adopts the Vercel / Cloudflare "drill-in" pattern: the URL drives
 * which sidebar *view* is rendered. Clicking a top-level entry like
 * `System Settings` swaps the sidebar to a contextual workspace —
 * with a `← Back to Dashboard` affordance — instead of stacking the
 * sub-navigation inside the root tree.
 *
 * Architecture:
 *   - View resolution + filtering: {@link useSidebarView}
 *   - View registry: `layout/lib/sidebar-view-registry.ts`
 *   - Per-view header: {@link SidebarViewHeader}
 *
 * Adding a new nested view only requires registering a {@link SidebarView}
 * in the registry; this component requires no changes.
 */
export function AppSidebar() {
  const { key, view, navGroups } = useSidebarView()
  const shouldReduce = useReducedMotion()

  return (
    <Sidebar collapsible='none' className='border-r'>
      {view && <SidebarViewHeader view={view} />}

      <SidebarContent className='[scrollbar-width:none] pt-4 pr-5 pb-4 pl-3 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={key}
            initial={
              shouldReduce ? false : MOTION_VARIANTS.sidebarSlide.initial
            }
            animate={MOTION_VARIANTS.sidebarSlide.animate}
            exit={shouldReduce ? undefined : MOTION_VARIANTS.sidebarSlide.exit}
            transition={MOTION_TRANSITION.fast}
            className='flex flex-col gap-5'
          >
            {navGroups.map((props) => (
              <NavGroup key={props.id || props.title} {...props} />
            ))}
          </motion.div>
        </AnimatePresence>
      </SidebarContent>
    </Sidebar>
  )
}
