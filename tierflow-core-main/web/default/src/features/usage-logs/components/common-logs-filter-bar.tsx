/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient, useIsFetching } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { type Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'
import { useIsAdmin } from '@/hooks/use-admin'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DateRangePicker } from '@/components/date-range-picker'
import { getApiKeys } from '@/features/keys/api'
import { LOG_TYPE_ALL_VALUE, LOG_TYPE_FILTERS } from '../constants'
import type { UsageLogsSearch } from '../search-schema'
import { useLogsNavigate } from '../use-logs-navigate'
import { buildSearchParams } from '../lib/filter'
import { getDefaultTimeRange } from '../lib/utils'
import type { CommonLogFilters } from '../types'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from './logs-filter-toolbar'

const TOKEN_ALL_VALUE = '__all_tokens__'
const logTypeValues = ['0', '1', '2', '3', '4', '5', '6'] as const

type LogTypeValue = (typeof logTypeValues)[number]

function isLogTypeValue(value: string): value is LogTypeValue {
  return (logTypeValues as readonly string[]).includes(value)
}

interface CommonLogsFilterBarProps<TData> {
  table: Table<TData>
}

export function CommonLogsFilterBar<TData>(
  props: CommonLogsFilterBarProps<TData>
) {
  const { t } = useTranslation()
  const navigate = useLogsNavigate()
  const queryClient = useQueryClient()
  // 与 UsageLogsTable 同理:不绑死路由,读的是「当前所在路由」的 search。
  const searchParams = useSearch({ strict: false }) as UsageLogsSearch
  const isAdmin = useIsAdmin()
  const fetchingLogs = useIsFetching({ queryKey: ['logs'] })

  const defaultRange = useMemo(() => getDefaultTimeRange(), [])
  const [filters, setFilters] = useState<CommonLogFilters>(() => ({
    startTime: defaultRange.start,
    endTime: defaultRange.end,
  }))
  const [logType, setLogType] = useState<LogTypeValue>(LOG_TYPE_ALL_VALUE)

  useEffect(() => {
    const { start, end } = getDefaultTimeRange()
    setFilters({
      startTime: searchParams.startTime
        ? new Date(searchParams.startTime)
        : start,
      endTime: searchParams.endTime ? new Date(searchParams.endTime) : end,
      channel: searchParams.channel || undefined,
      model: searchParams.model || undefined,
      token: searchParams.token || undefined,
      group: searchParams.group || undefined,
      username: searchParams.username || undefined,
      requestId: searchParams.requestId || undefined,
      upstreamRequestId: searchParams.upstreamRequestId || undefined,
    })

    const typeArr = searchParams.type
    const nextLogType =
      Array.isArray(typeArr) &&
      typeArr.length === 1 &&
      isLogTypeValue(typeArr[0])
        ? typeArr[0]
        : LOG_TYPE_ALL_VALUE
    setLogType(nextLogType)
  }, [
    searchParams.startTime,
    searchParams.endTime,
    searchParams.channel,
    searchParams.model,
    searchParams.token,
    searchParams.group,
    searchParams.username,
    searchParams.requestId,
    searchParams.upstreamRequestId,
    searchParams.type,
  ])

  // Filters apply the moment the user changes them — no Search button. Discrete
  // controls (date range, type) commit instantly; free-text inputs commit on a
  // short debounce so we don't fire a request on every keystroke, and flush
  // immediately on Enter. `applyFilters` accepts overrides so a control can
  // commit its just-picked value without waiting for the async state update.
  const applyFilters = useCallback(
    (overrides?: { filters?: CommonLogFilters; logType?: LogTypeValue }) => {
      const nextFilters = overrides?.filters ?? filters
      const nextLogType = overrides?.logType ?? logType
      const filterParams = buildSearchParams(nextFilters, 'common')
      // 不带 to:停留在当前路由。日志表现在挂在用量信息页(/usage),独立的
      // /usage-logs 页已下线,写死目标路由会把用户踢出当前页。
      navigate({
        search: {
          ...filterParams,
          type: [nextLogType],
          page: 1,
        },
      })
      queryClient.invalidateQueries({ queryKey: ['logs'] })
      queryClient.invalidateQueries({ queryKey: ['usage-logs-stats'] })
    },
    [filters, logType, navigate, queryClient]
  )

  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingApply = useCallback(() => {
    if (applyTimer.current) {
      clearTimeout(applyTimer.current)
      applyTimer.current = null
    }
  }, [])
  useEffect(() => cancelPendingApply, [cancelPendingApply])

  const handleTextChange = useCallback(
    (field: keyof CommonLogFilters, value: string) => {
      const nextFilters = { ...filters, [field]: value || undefined }
      setFilters(nextFilters)
      cancelPendingApply()
      applyTimer.current = setTimeout(
        () => applyFilters({ filters: nextFilters }),
        400
      )
    },
    [filters, applyFilters, cancelPendingApply]
  )

  const handleDateChange = useCallback(
    (start: Date, end: Date) => {
      const nextFilters = { ...filters, startTime: start, endTime: end }
      setFilters(nextFilters)
      cancelPendingApply()
      applyFilters({ filters: nextFilters })
    },
    [filters, applyFilters, cancelPendingApply]
  )

  const handleTypeChange = useCallback(
    (next: LogTypeValue) => {
      setLogType(next)
      cancelPendingApply()
      applyFilters({ logType: next })
    },
    [applyFilters, cancelPendingApply]
  )

  const handleTokenChange = useCallback(
    (next: string | undefined) => {
      const nextFilters = { ...filters, token: next }
      setFilters(nextFilters)
      cancelPendingApply()
      applyFilters({ filters: nextFilters })
    },
    [filters, applyFilters, cancelPendingApply]
  )

  const handleReset = useCallback(() => {
    cancelPendingApply()
    const { start, end } = getDefaultTimeRange()
    const resetFilters: CommonLogFilters = { startTime: start, endTime: end }
    setFilters(resetFilters)
    setLogType(LOG_TYPE_ALL_VALUE)

    navigate({
      search: {
        page: 1,
        type: [LOG_TYPE_ALL_VALUE],
        startTime: start.getTime(),
        endTime: end.getTime(),
      },
    })
    queryClient.invalidateQueries({ queryKey: ['logs'] })
    queryClient.invalidateQueries({ queryKey: ['usage-logs-stats'] })
  }, [navigate, queryClient])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        cancelPendingApply()
        applyFilters()
      }
    },
    [applyFilters, cancelPendingApply]
  )

  // Everything except the date range lives inside the Filter popover, so the
  // badge on that button counts every active condition it holds.
  const hasTypeFilter = logType !== LOG_TYPE_ALL_VALUE
  const filterCount = [
    filters.model,
    hasTypeFilter,
    filters.token,
    isAdmin ? filters.username : undefined,
    isAdmin ? filters.channel : undefined,
    filters.requestId,
    filters.upstreamRequestId,
  ].filter(Boolean).length
  const hasAdditionalFilters = filterCount > 0
  const logTypeItems = useMemo(
    () =>
      LOG_TYPE_FILTERS.map((type) => ({
        value: type.value,
        label: t(type.label),
      })),
    [t]
  )

  const { data: tokensData } = useQuery({
    queryKey: ['filter-tokens'],
    queryFn: () => getApiKeys({ p: 1, size: 100 }),
    staleTime: 5 * 60 * 1000,
  })
  const tokenNames = useMemo(() => {
    const items = tokensData?.data?.items ?? []
    return Array.from(
      new Set(items.map((item) => item.name).filter(Boolean))
    ).sort()
  }, [tokensData])
  const tokenItems = useMemo(
    () => [
      { value: TOKEN_ALL_VALUE, label: t('All Tokens') },
      ...tokenNames.map((name) => ({ value: name, label: name })),
    ],
    [tokenNames, t]
  )
  const tokenValue = filters.token || TOKEN_ALL_VALUE

  const dateRangeFilter = (
    <LogsFilterField className='shrink-0'>
      {/* h-9 + 全圆角,与同行的 pill 尺寸按钮对齐;移动端在常驻区独占一行 */}
      <DateRangePicker
        className='h-9 w-full rounded-full sm:w-auto'
        start={filters.startTime ?? defaultRange.start}
        end={filters.endTime ?? defaultRange.end}
        onChange={({ start, end }) => handleDateChange(start, end)}
      />
    </LogsFilterField>
  )
  const modelFilter = (
    <LogsFilterField className='w-full'>
      <LogsFilterInput
        placeholder={t('Model Name')}
        value={filters.model || ''}
        onChange={(e) => handleTextChange('model', e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </LogsFilterField>
  )
  const typeFilter = (
    <LogsFilterField className='w-full'>
      <Select
        items={logTypeItems}
        value={logType}
        onValueChange={(value) =>
          handleTypeChange(
            value !== null && isLogTypeValue(value)
              ? value
              : LOG_TYPE_ALL_VALUE
          )
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={t('All Types')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {LOG_TYPE_FILTERS.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {t(type.label)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </LogsFilterField>
  )
  const tokenFilter = (
    <LogsFilterField className='w-full'>
      <Select
        items={tokenItems}
        value={tokenValue}
        onValueChange={(value) =>
          handleTokenChange(
            value === null || value === TOKEN_ALL_VALUE ? undefined : value
          )
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={t('All Tokens')} />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectGroup>
            {tokenItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </LogsFilterField>
  )
  const identityFilters = (
    <>
      {isAdmin && (
        <LogsFilterField>
          <LogsFilterInput
            placeholder={t('Username')}
            value={filters.username || ''}
            onChange={(e) => handleTextChange('username', e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </LogsFilterField>
      )}
      {isAdmin && (
        <LogsFilterField>
          <LogsFilterInput
            placeholder={t('Channel ID')}
            value={filters.channel || ''}
            onChange={(e) => handleTextChange('channel', e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </LogsFilterField>
      )}
      <LogsFilterField>
        <LogsFilterInput
          placeholder={t('Request ID')}
          value={filters.requestId || ''}
          onChange={(e) => handleTextChange('requestId', e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          placeholder={t('Upstream Request ID')}
          value={filters.upstreamRequestId || ''}
          onChange={(e) => handleTextChange('upstreamRequestId', e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </LogsFilterField>
    </>
  )

  const popoverFilters = (
    <>
      {modelFilter}
      {typeFilter}
      {tokenFilter}
      {identityFilters}
    </>
  )

  return (
    <LogsFilterToolbar
      table={props.table}
      leading={
        <h3 className='text-base font-semibold tracking-tight'>
          {t('Activity Log')}
        </h3>
      }
      primaryFilters={dateRangeFilter}
      advancedFilters={popoverFilters}
      mobilePinnedFilters={dateRangeFilter}
      mobileFilters={popoverFilters}
      mobileFilterCount={filterCount}
      hasAdvancedActiveFilters={hasAdditionalFilters}
      advancedFilterCount={filterCount}
      hasActiveFilters={hasAdditionalFilters}
      onSearch={() => {
        cancelPendingApply()
        applyFilters()
      }}
      searchLoading={fetchingLogs > 0}
      onReset={handleReset}
    />
  )
}
