/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { SkillMarketplace } from '@/features/skills/skill-marketplace'

export const Route = createFileRoute('/_authenticated/skills/')({
  component: SkillMarketplace,
})
