/*
Copyright (C) 2023-2026 TierFlow
*/
import { createFileRoute } from '@tanstack/react-router'
import { ForbiddenError } from '@/features/errors/forbidden'

export const Route = createFileRoute('/(errors)/403')({
  component: ForbiddenError,
})
