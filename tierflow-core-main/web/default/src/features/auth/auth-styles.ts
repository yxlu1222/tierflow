/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Shared styling for the TierFlow auth surface (sign-in / sign-up / etc).
 *
 * The auth pages intentionally render in a light, brand-specific palette that
 * mirrors the TierFlow marketing site: white inputs with an orange (#f97316)
 * focus ring and a dark (#111827) primary action. The `dark:` overrides keep
 * the form readable even when the rest of the app is in dark mode.
 */

// Inputs: bump height/radius and swap the default ring for the TierFlow orange.
export const authInputClass =
  'h-11 rounded-md border-[#e5e7eb] bg-white px-3.5 text-sm text-[#111827] placeholder:text-[#9ca3af] focus-visible:border-[#f97316] focus-visible:ring-[3px] focus-visible:ring-[#f97316]/15'

// Field labels: small mono uppercase caption, matching the marketing site.
export const authLabelClass =
  'font-mono text-xs font-normal uppercase tracking-[0.06em] text-[#6b7280]'

// Tightens the FormItem grid gap so the label sits close to its input.
export const authFieldClass = 'gap-1.5'

// Primary submit button: full-width dark pill with a subtle lift on hover.
export const authSubmitClass =
  'mt-2 h-[46px] w-full rounded-md bg-[#111827] text-sm font-medium text-white transition-all hover:-translate-y-px hover:bg-[#1f2937] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-[#111827] disabled:hover:shadow-none'

// Bottom "switch page" prompt (e.g. "Don't have an account? Sign up now").
export const authSwitchTextClass =
  'mt-8 text-center text-[13px] leading-7 text-[#6b7280]'

export const authSwitchLinkClass =
  'text-[#111827] underline decoration-[#d1d5db] underline-offset-4 transition-colors hover:decoration-[#f97316]'
