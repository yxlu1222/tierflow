/*
Copyright (C) 2023-2026 TierFlow
*/
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSystemConfig } from '@/hooks/use-system-config'
import { Markdown } from '@/components/ui/markdown'
import { HeaderLogo } from '@/components/layout'

type LegalDocumentProps = {
  title: string
  /** Hardcoded document body in Markdown. */
  content: string
}

export function LegalDocument({ title, content }: LegalDocumentProps) {
  const { t } = useTranslation()
  const { systemName, logo, loading, logoLoaded } = useSystemConfig()

  return (
    <div className='bg-background text-foreground min-h-svh'>
      <header className='border-border/60 sticky top-0 z-10 border-b bg-white/90 backdrop-blur'>
        <div className='mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6'>
          <div className='flex items-center gap-2.5'>
            <HeaderLogo
              src={logo}
              alt={systemName}
              loading={loading}
              logoLoaded={logoLoaded}
              className='size-7 rounded-lg object-contain'
            />
            <div>
              <p className='text-sm font-semibold'>{systemName}</p>
              <p className='text-[10px] tracking-[0.08em] text-blue-600 uppercase'>
                {t('Inference Appliance')}
              </p>
            </div>
          </div>
          <Link
            to='/sign-in'
            className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors'
          >
            <ArrowLeft className='size-4' />
            {t('Back to sign in')}
          </Link>
        </div>
      </header>
      <main className='mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6 sm:py-12'>
        <div className='space-y-2'>
          <h1 className='text-3xl font-semibold tracking-tight'>{title}</h1>
        </div>

        <Markdown className='prose-neutral max-w-none'>{content}</Markdown>
      </main>
    </div>
  )
}
