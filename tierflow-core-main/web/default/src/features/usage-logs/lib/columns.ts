/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Column definitions factory
 */
import type { ColumnDef } from '@tanstack/react-table'
import { useCommonLogsColumns } from '../components/columns/common-logs-columns'
import type { LogCategory } from '../types'

/**
 * Get column definitions based on log category
 */
export function useColumnsByCategory(
  _logCategory: LogCategory,
  isAdmin: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ColumnDef<any>[] {
  return useCommonLogsColumns(isAdmin)
}
