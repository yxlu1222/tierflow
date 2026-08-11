/*
Copyright (C) 2023-2026 TierFlow
*/
import { PublicLayout } from '@/components/layout'
import { TierFlowLanding } from './components/sections/tierflow-landing'

export function Home() {
  return (
    <PublicLayout showMainContainer={false}>
      <TierFlowLanding />
    </PublicLayout>
  )
}
