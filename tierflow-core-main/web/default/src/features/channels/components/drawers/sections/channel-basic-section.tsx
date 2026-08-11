/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ReactNode } from 'react'
import { Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'

type ChannelBasicSectionProps = {
  children: ReactNode
}

export function ChannelBasicSection(props: ChannelBasicSectionProps) {
  const { t } = useTranslation()

  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('Basic Information')}
        description={t('Name, provider type, and availability.')}
        icon={<Server className='h-4 w-4' aria-hidden='true' />}
      />
      {props.children}
    </SideDrawerSection>
  )
}
