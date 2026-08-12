/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * Shared styling for the TierFlow auth surface (sign-in / sign-up / etc).
 *
 * The appliance auth surface uses a light, brand-specific palette with white
 * inputs, a blue focus ring, and a blue primary action.
 */

// Inputs: use a clear appliance-blue focus state.
export const authInputClass =
  'h-11 rounded-lg border-[#dbe3ef] bg-white px-3.5 text-sm text-[#111827] placeholder:text-[#9ca3af] focus-visible:border-[#2563eb] focus-visible:ring-[3px] focus-visible:ring-[#2563eb]/15'

// Field labels: compact uppercase system caption.
export const authLabelClass =
  'font-mono text-xs font-normal uppercase tracking-[0.06em] text-[#6b7280]'

// Tightens the FormItem grid gap so the label sits close to its input.
export const authFieldClass = 'gap-1.5'

// Primary submit button: full-width appliance-blue action.
export const authSubmitClass =
  'mt-2 h-[46px] w-full rounded-lg bg-[#2563eb] text-sm font-medium text-white shadow-[0_8px_24px_rgba(37,99,235,0.2)] transition-all hover:-translate-y-px hover:bg-[#1d4ed8] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:bg-[#2563eb] disabled:hover:shadow-none'

// Bottom "switch page" prompt (e.g. "Don't have an account? Sign up now").
export const authSwitchTextClass =
  'mt-8 text-center text-[13px] leading-7 text-[#6b7280]'

export const authSwitchLinkClass =
  'text-[#111827] underline decoration-[#d1d5db] underline-offset-4 transition-colors hover:decoration-[#2563eb]'
