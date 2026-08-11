/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'
import type { TFunction } from 'i18next'

// ============================================================================
// Form Schemas
// ============================================================================
// 校验消息必须走 t():schema 由工厂函数按当前语言构造(参见
// system-settings 的 createPricingSchema 模式),否则登录/注册/忘记密码
// 页的表单错误恒为英文。

export const getLoginFormSchema = (t: TFunction) =>
  z.object({
    username: z.string().min(1, t('Please enter your username or email')),
    password: z
      .string()
      .min(1, t('Please enter your password'))
      .min(8, t('Password must be at least 8 characters long')),
  })

export const getRegisterFormSchema = (t: TFunction) =>
  z
    .object({
      username: z.string().min(1, t('Please enter your username')),
      email: z.string().optional(),
      password: z
        .string()
        .min(1, t('Please enter your password'))
        .min(8, t('Password must be at least 8 characters long'))
        .max(20, t('Password must be at most 20 characters long')),
      confirmPassword: z.string().min(1, t('Please confirm your password')),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t("Passwords don't match."),
      path: ['confirmPassword'],
    })

export const getForgotPasswordFormSchema = (t: TFunction) =>
  z.object({
    email: z.string().email({
      message: t('Please enter a valid email address'),
    }),
  })

export const getOtpFormSchema = (t: TFunction) =>
  z.object({
    otp: z.string().min(1, t('Please enter a code.')),
  })

// 类型推导用的静态形状(与工厂产物同构;消费方 z.infer 用这些,
// resolver 用工厂产物)
const identityT = ((key: string) => key) as unknown as TFunction
export const loginFormSchema = getLoginFormSchema(identityT)
export const registerFormSchema = getRegisterFormSchema(identityT)
export const forgotPasswordFormSchema = getForgotPasswordFormSchema(identityT)
export const otpFormSchema = getOtpFormSchema(identityT)

// ============================================================================
// Validation Constants
// ============================================================================

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 20
export const OTP_LENGTH = 6
export const BACKUP_CODE_LENGTH = 9 // XXXX-XXXX format
export const BACKUP_CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/i
export const OTP_REGEX = /^\d{6}$/

// ============================================================================
// Countdown Constants
// ============================================================================

export const EMAIL_VERIFICATION_COUNTDOWN = 30 // seconds
export const PASSWORD_RESET_COUNTDOWN = 30 // seconds

// ============================================================================
// OAuth Constants
// ============================================================================

export const OAUTH_BIND_STORAGE_KEY = 'oauth:binding:result'
