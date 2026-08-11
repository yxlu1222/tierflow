/*
Copyright (C) 2023-2026 TierFlow
*/
import { type ReactNode } from 'react'
import { CreditCard } from 'lucide-react'
import { SiAlipay, SiWechat } from 'react-icons/si'
import { PAYMENT_TYPES, PAYMENT_ICON_COLORS } from '../constants'

// ============================================================================
// UI Helper Functions
// ============================================================================

const HAS_LOCATION =
  typeof globalThis !== 'undefined' && 'location' in globalThis

/**
 * Resolves a backend-provided image URL to http(s) only. Rejects javascript:,
 * data:, blob:, file:, and URLs with userinfo, which are unsafe in <img src/>.
 */
function normalizeHttpIconUrl(raw: string | undefined | null): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  let url: URL
  try {
    url = HAS_LOCATION
      ? new URL(s, (globalThis as { location: Location }).location.href)
      : new URL(s)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }
  if (url.username || url.password) {
    return null
  }
  return url.toString()
}

/**
 * Get payment method icon component
 *
 * When iconUrl is provided, render an <img/> with that URL so custom
 * gateway logos can be configured per-method.
 */
export function getPaymentIcon(
  paymentType: string | undefined,
  className: string = 'h-4 w-4',
  iconUrl?: string,
  altName?: string
): ReactNode {
  const safeIconUrl = normalizeHttpIconUrl(iconUrl)
  if (safeIconUrl) {
    return (
      <img
        src={safeIconUrl}
        alt={altName || paymentType || 'payment'}
        className={className}
        style={{ objectFit: 'contain' }}
        loading='lazy'
        decoding='async'
        referrerPolicy='no-referrer'
      />
    )
  }

  if (!paymentType) {
    return <CreditCard className={className} />
  }

  switch (paymentType) {
    case PAYMENT_TYPES.ALIPAY:
      return (
        <SiAlipay
          className={className}
          style={{ color: PAYMENT_ICON_COLORS[PAYMENT_TYPES.ALIPAY] }}
        />
      )
    case PAYMENT_TYPES.WECHAT:
      return (
        <SiWechat
          className={className}
          style={{ color: PAYMENT_ICON_COLORS[PAYMENT_TYPES.WECHAT] }}
        />
      )
    default:
      return <CreditCard className={className} />
  }
}
