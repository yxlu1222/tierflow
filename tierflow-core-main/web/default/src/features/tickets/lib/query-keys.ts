/*
Copyright (C) 2023-2026 TierFlow
*/
export const ticketsQueryKeys = {
  all: ['tickets'] as const,
  lists: () => [...ticketsQueryKeys.all, 'list'] as const,
  list: (scope: 'self' | 'admin', filters: unknown) =>
    [...ticketsQueryKeys.lists(), scope, filters] as const,
  details: () => [...ticketsQueryKeys.all, 'detail'] as const,
  detail: (scope: 'self' | 'admin', id: number) =>
    [...ticketsQueryKeys.details(), scope, id] as const,
  stats: () => [...ticketsQueryKeys.all, 'stats'] as const,
}
