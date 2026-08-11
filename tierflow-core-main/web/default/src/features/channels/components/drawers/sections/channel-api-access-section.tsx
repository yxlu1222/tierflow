/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ReactNode } from 'react'
import { Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'

type ChannelApiAccessSectionProps = {
  children: ReactNode
}

export function ChannelApiAccessSection(props: ChannelApiAccessSectionProps) {
  const { t } = useTranslation()

  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('API Access')}
        description={t(
          'Endpoint, provider-specific settings, and credentials.'
        )}
        icon={<Link2 className='h-4 w-4' aria-hidden='true' />}
      />
      {props.children}
    </SideDrawerSection>
  )
}
