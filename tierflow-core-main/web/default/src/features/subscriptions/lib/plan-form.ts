/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'
import type { TFunction } from 'i18next'
import { parseQuotaFromDollars, quotaUnitsToDollars } from '@/lib/format'
import type { SubscriptionPlan, PlanPayload } from '../types'

export function getPlanFormSchema(t: TFunction) {
  // 金额/额度框:允许编辑时清空(值为 undefined),空/非法只在保存时由下方
  // superRefine 报错;此处 .optional() 仅解决 RHF 瞬态空值与类型的矛盾。
  // <input type=number> 的 onChange 只会给出 undefined 或合法数字,不会有 NaN。
  const money = (msg: string) => z.number({ error: msg }).min(0, msg)
  return z
    .object({
      title: z.string().min(1, t('Please enter plan title')),
      subtitle: z.string().optional(),
      price_amount: money(t('Please enter amount')).optional(),
      duration_unit: z.enum(['year', 'month', 'day', 'hour', 'custom']),
      duration_value: z.coerce.number().min(1),
      custom_seconds: z.coerce.number().min(0).optional(),
      quota_reset_period: z.enum([
        'never',
        'daily',
        'weekly',
        'monthly',
        'custom',
      ]),
      quota_reset_custom_seconds: z.coerce.number().min(0).optional(),
      enabled: z.boolean(),
      sort_order: z.coerce.number(),
      recommended: z.boolean(),
      allow_balance_pay: z.boolean(),
      max_purchase_per_user: z.coerce.number().min(0),
      total_amount: money(t('Please enter premium credit')).optional(),
      // 基础模型桶(token 数);无限用开关表达,提交时转 -1
      basic_token_total: money(t('Please enter basic tokens')).optional(),
      basic_unlimited: z.boolean(),
      premium_set_id: z.coerce.number().min(0),
      basic_set_id: z.coerce.number().min(0),
      upgrade_group: z.string().optional(),
    })
    .superRefine((val, ctx) => {
      // 保存时才校验金额/额度是否为空(空 = undefined)
      if (val.price_amount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['price_amount'],
          message: t('Please enter amount'),
        })
      }
      if (val.total_amount === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['total_amount'],
          message: t('Please enter premium credit'),
        })
      }
      // 基础桶:选了「无限」则不强制填数
      if (!val.basic_unlimited && val.basic_token_total === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['basic_token_total'],
          message: t('Please enter basic tokens'),
        })
      }
    })
}

export type PlanFormValues = z.infer<ReturnType<typeof getPlanFormSchema>>

export const PLAN_FORM_DEFAULTS: PlanFormValues = {
  title: '',
  subtitle: '',
  // 金额/额度默认预填 0,但允许在框内删空(删空后保存会校验非空,见 getPlanFormSchema)
  price_amount: 0,
  // 套餐规范:统一 30 天(docs/subscription-gap-analysis.md §1);
  // month 走自然月(1/31+1月→3/3),新套餐勿用
  duration_unit: 'day',
  duration_value: 30,
  custom_seconds: 0,
  quota_reset_period: 'never',
  quota_reset_custom_seconds: 0,
  enabled: true,
  sort_order: 0,
  recommended: false,
  allow_balance_pay: true,
  max_purchase_per_user: 0,
  total_amount: 0,
  basic_token_total: 0,
  basic_unlimited: false,
  premium_set_id: 0,
  basic_set_id: 0,
  upgrade_group: '',
}

export function planToFormValues(plan: SubscriptionPlan): PlanFormValues {
  return {
    title: plan.title || '',
    subtitle: plan.subtitle || '',
    price_amount: Number(plan.price_amount || 0),
    duration_unit: plan.duration_unit || 'month',
    duration_value: Number(plan.duration_value || 1),
    custom_seconds: Number(plan.custom_seconds || 0),
    quota_reset_period: plan.quota_reset_period || 'never',
    quota_reset_custom_seconds: Number(plan.quota_reset_custom_seconds || 0),
    enabled: plan.enabled !== false,
    sort_order: Number(plan.sort_order || 0),
    recommended: plan.recommended === true,
    allow_balance_pay: plan.allow_balance_pay !== false,
    max_purchase_per_user: Number(plan.max_purchase_per_user || 0),
    total_amount: quotaUnitsToDollars(Number(plan.total_amount || 0)),
    basic_token_total: Math.max(0, Number(plan.basic_token_total || 0)),
    basic_unlimited: Number(plan.basic_token_total || 0) === -1,
    premium_set_id: Number(plan.premium_set_id || 0),
    basic_set_id: Number(plan.basic_set_id || 0),
    upgrade_group: plan.upgrade_group || '',
  }
}

export function formValuesToPlanPayload(values: PlanFormValues): PlanPayload {
  return {
    plan: {
      ...values,
      price_amount: Number(values.price_amount || 0),
      duration_value: Number(values.duration_value || 0),
      custom_seconds: Number(values.custom_seconds || 0),
      quota_reset_period: values.quota_reset_period || 'never',
      quota_reset_custom_seconds:
        values.quota_reset_period === 'custom'
          ? Number(values.quota_reset_custom_seconds || 0)
          : 0,
      sort_order: Number(values.sort_order || 0),
      max_purchase_per_user: Number(values.max_purchase_per_user || 0),
      total_amount: parseQuotaFromDollars(Number(values.total_amount || 0)),
      basic_token_total: values.basic_unlimited
        ? -1
        : Number(values.basic_token_total || 0),
      premium_set_id: Number(values.premium_set_id || 0),
      basic_set_id: Number(values.basic_set_id || 0),
      upgrade_group: values.upgrade_group || '',
    },
  }
}
