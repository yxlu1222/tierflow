/*
Copyright (C) 2023-2026 TierFlow
*/
import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { Main } from './main'
import { PageFooterProvider } from './page-footer'

type SlotProps = { children?: ReactNode }

function SectionPageLayoutTitle(_props: SlotProps) {
  return null
}
SectionPageLayoutTitle.displayName = 'SectionPageLayout.Title'

function SectionPageLayoutActions(_props: SlotProps) {
  return null
}
SectionPageLayoutActions.displayName = 'SectionPageLayout.Actions'

function SectionPageLayoutContent(_props: SlotProps) {
  return null
}
SectionPageLayoutContent.displayName = 'SectionPageLayout.Content'

function SectionPageLayoutBreadcrumb(_props: SlotProps) {
  return null
}
SectionPageLayoutBreadcrumb.displayName = 'SectionPageLayout.Breadcrumb'

export type SectionPageLayoutProps = {
  children: ReactNode
  /**
   * Scroll the title/header together with the content instead of pinning it at
   * the top. On by default (single scroll container, matching the dashboard).
   * Pass `scrollHeader={false}` to pin the header above the scroll area.
   */
  scrollHeader?: boolean
}

export function SectionPageLayout(props: SectionPageLayoutProps) {
  const [footerContainer, setFooterContainer] = useState<HTMLDivElement | null>(
    null
  )

  let title: ReactNode = null
  let actions: ReactNode = null
  let content: ReactNode = null
  let breadcrumb: ReactNode = null

  Children.forEach(props.children, (node) => {
    if (!isValidElement(node)) return
    const child = node as ReactElement<SlotProps>
    if (child.type === SectionPageLayoutTitle) title = child.props.children
    else if (child.type === SectionPageLayoutActions)
      actions = child.props.children
    else if (child.type === SectionPageLayoutContent)
      content = child.props.children
    else if (child.type === SectionPageLayoutBreadcrumb)
      breadcrumb = child.props.children
  })

  const header =
    title != null || actions != null || breadcrumb != null ? (
      <div className='px-4 pt-5 pb-2.5 sm:px-10 sm:pt-8 sm:pb-3'>
        {breadcrumb != null && <div className='mb-2 sm:mb-3'>{breadcrumb}</div>}
        <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:gap-x-4'>
          <div className='min-w-0 flex-1'>
            <h2 className='text-foreground m-0 text-xl font-semibold tracking-tight sm:text-2xl'>
              {title}
            </h2>
          </div>
          {actions != null && (
            <div className='flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-x-4'>
              {actions}
            </div>
          )}
        </div>
      </div>
    ) : null

  return (
    <PageFooterProvider container={footerContainer}>
      <Main>
        {props.scrollHeader !== false ? (
          // Header scrolls with the content (single scroll container, default).
          <div className='min-h-0 flex-1 overflow-auto'>
            {header}
            <div
              className={cn(
                'px-4 pb-5 sm:px-10 sm:pb-8',
                header == null ? 'pt-4 sm:pt-7' : 'pt-1 sm:pt-1.5'
              )}
            >
              {content}
            </div>
          </div>
        ) : (
          // Header pinned above the scroll area (opt-in via scrollHeader={false}).
          <>
            <div className='shrink-0'>{header}</div>
            <div className='min-h-0 flex-1 overflow-auto px-4 pt-1 pb-5 sm:px-10 sm:pt-1.5 sm:pb-8'>
              {content}
            </div>
          </>
        )}

        <div
          ref={setFooterContainer}
          className='bg-background shrink-0 border-t px-4 py-2.5 empty:hidden sm:px-10 sm:py-3'
        />
      </Main>
    </PageFooterProvider>
  )
}

SectionPageLayout.Title = SectionPageLayoutTitle
SectionPageLayout.Actions = SectionPageLayoutActions
SectionPageLayout.Content = SectionPageLayoutContent
SectionPageLayout.Breadcrumb = SectionPageLayoutBreadcrumb
