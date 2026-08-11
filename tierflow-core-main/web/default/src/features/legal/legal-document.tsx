/*
Copyright (C) 2023-2026 TierFlow
*/
import { Markdown } from '@/components/ui/markdown'
import { PublicLayout } from '@/components/layout'

type LegalDocumentProps = {
  title: string
  /** Hardcoded document body in Markdown. */
  content: string
}

export function LegalDocument({ title, content }: LegalDocumentProps) {
  return (
    <PublicLayout>
      <div className='mx-auto max-w-4xl space-y-6 py-12'>
        <div className='space-y-2'>
          <h1 className='text-3xl font-semibold tracking-tight'>{title}</h1>
        </div>

        <Markdown className='prose-neutral max-w-none'>{content}</Markdown>
      </div>
    </PublicLayout>
  )
}
