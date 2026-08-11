/*
Copyright (C) 2023-2026 TierFlow
*/
import type { ReactNode } from 'react'
import { Boxes } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  SideDrawerSection,
  SideDrawerSectionHeader,
} from '@/components/drawer-layout'

type ChannelModelsSectionProps = {
  children: ReactNode
}

export function ChannelModelsSection(props: ChannelModelsSectionProps) {
  const { t } = useTranslation()

  return (
    <SideDrawerSection>
      <SideDrawerSectionHeader
        title={t('Models & Groups')}
        description={t('Published models, groups, and model remapping rules.')}
        icon={<Boxes className='h-4 w-4' aria-hidden='true' />}
      />
      {props.children}
    </SideDrawerSection>
  )
}
