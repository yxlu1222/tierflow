/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Utility functions for usage logs filters
 */
import type {
  LogCategory,
  LogFilters,
  CommonLogFilters,
} from '../types'

// ============================================================================
// Filter Building Functions
// ============================================================================

/**
 * Build search params from filters based on log category
 */
export function buildSearchParams(
  filters: LogFilters,
  _logCategory: LogCategory
): Record<string, unknown> {
  const baseParams: Record<string, unknown> = {
    ...(filters.startTime && { startTime: filters.startTime.getTime() }),
    ...(filters.endTime && { endTime: filters.endTime.getTime() }),
    ...(filters.channel && { channel: filters.channel }),
  }

  const commonFilters = filters as CommonLogFilters
  return {
    ...baseParams,
    ...(commonFilters.model && { model: commonFilters.model }),
    ...(commonFilters.token && { token: commonFilters.token }),
    ...(commonFilters.group && { group: commonFilters.group }),
    ...(commonFilters.username && { username: commonFilters.username }),
    ...(commonFilters.requestId && { requestId: commonFilters.requestId }),
    ...(commonFilters.upstreamRequestId && {
      upstreamRequestId: commonFilters.upstreamRequestId,
    }),
  }
}
