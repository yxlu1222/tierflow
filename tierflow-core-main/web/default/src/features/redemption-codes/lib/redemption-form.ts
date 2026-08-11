/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'
import type { TFunction } from 'i18next'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import {
  REDEMPTION_TYPE,
  REDEMPTION_VALIDATION,
  getRedemptionFormErrorMessages,
} from '../constants'
import { type RedemptionFormData, type Redemption } from '../types'

// ============================================================================
// Form Schema (use getRedemptionFormSchema(t) in components for i18n messages)
// ============================================================================

export function getRedemptionFormSchema(t: TFunction) {
  const msg = getRedemptionFormErrorMessages(t)
  return z
    .object({
      name: z
        .string()
        .min(REDEMPTION_VALIDATION.NAME_MIN_LENGTH, msg.NAME_LENGTH_INVALID)
        .max(REDEMPTION_VALIDATION.NAME_MAX_LENGTH, msg.NAME_LENGTH_INVALID),
      type: z.number(),
      quota_dollars: z.number().min(0, t('Quota must be a positive number')),
      plan_id: z.number().optional(),
      expired_time: z.date().optional(),
      count: z
        .number()
        .min(REDEMPTION_VALIDATION.COUNT_MIN, msg.COUNT_INVALID)
        .max(REDEMPTION_VALIDATION.COUNT_MAX, msg.COUNT_INVALID)
        .optional(),
    })
    // 订阅码必须选套餐；后端也会校验，这里提前拦住以免白跑一趟。
    .refine(
      (data) =>
        data.type !== REDEMPTION_TYPE.SUBSCRIPTION ||
        (data.plan_id !== undefined && data.plan_id > 0),
      {
        message: t('Please select a plan for the subscription code'),
        path: ['plan_id'],
      }
    )
}

export type RedemptionFormValues = {
  name: string
  type: number
  quota_dollars: number
  plan_id?: number
  expired_time?: Date
  count?: number
}

// ============================================================================
// Form Defaults
// ============================================================================

export const REDEMPTION_FORM_DEFAULT_VALUES: RedemptionFormValues = {
  name: '',
  type: REDEMPTION_TYPE.QUOTA,
  quota_dollars: 10,
  plan_id: undefined,
  expired_time: undefined,
  count: 1,
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload
 */
export function transformFormDataToPayload(
  data: RedemptionFormValues
): RedemptionFormData {
  const isSubscription = data.type === REDEMPTION_TYPE.SUBSCRIPTION
  return {
    name: data.name,
    type: data.type,
    // 订阅码的面额由套餐决定，额度字段置 0 以免留下会误导人的残值
    quota: isSubscription ? 0 : parseQuotaFromDollars(data.quota_dollars),
    plan_id: isSubscription ? data.plan_id : 0,
    expired_time: data.expired_time
      ? Math.floor(data.expired_time.getTime() / 1000)
      : 0,
    count: data.count || 1,
  }
}

/**
 * Transform redemption data to form defaults
 */
export function transformRedemptionToFormDefaults(
  redemption: Redemption
): RedemptionFormValues {
  return {
    name: redemption.name,
    type: redemption.type ?? REDEMPTION_TYPE.QUOTA,
    quota_dollars: quotaUnitsToDollars(redemption.quota),
    plan_id: redemption.plan_id || undefined,
    expired_time:
      redemption.expired_time > 0
        ? new Date(redemption.expired_time * 1000)
        : undefined,
    count: 1,
  }
}
