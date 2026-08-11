/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { Skeleton } from '@/components/ui/skeleton'
import { getDisplayName } from '../lib'
import type { UserProfile } from '../types'

// ============================================================================
// Profile Hero — gradient hero (avatar + identity)
// ============================================================================

interface ProfileHeroProps {
  profile: UserProfile | null
  loading: boolean
}

export function ProfileHero({ profile, loading }: ProfileHeroProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopyUid = async () => {
    if (!profile?.uid) return
    if (await copyToClipboard(profile.uid)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const displayName = profile ? getDisplayName(profile) : ''
  // Mirror the header avatar: hash-based color + single-letter fallback,
  // derived from the username (falling back to the display name).
  const avatarName = profile ? profile.username || displayName : ''
  const avatarFallback = getUserAvatarFallback(avatarName)
  const avatarStyle = getUserAvatarStyle(avatarName)

  return (
    <section className='bg-card relative overflow-hidden rounded-2xl border p-6 shadow-xs sm:p-7'>
      {/* Subtle brand glow, top-left — theme-aware via the primary token
          (same treatment as the Billing / API Keys heroes). */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at top left, color-mix(in srgb, var(--primary) 13%, transparent), transparent 42%)',
        }}
      />

      <div className='relative'>
        <div className='flex min-w-0 items-center gap-4'>
          {loading ? (
            <Skeleton className='h-16 w-16 shrink-0 rounded-full sm:h-20 sm:w-20' />
          ) : (
            <div
              className='border-border flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-2xl font-semibold shadow-sm sm:h-20 sm:w-20 sm:text-3xl'
              style={avatarStyle}
            >
              {avatarFallback}
            </div>
          )}

          <div className='min-w-0'>
            {loading ? (
              <>
                <Skeleton className='h-8 w-48' />
                <Skeleton className='mt-2 h-[18px] w-44' />
              </>
            ) : (
              <>
                <h1 className='truncate text-2xl font-semibold tracking-tight sm:text-3xl'>
                  {displayName}
                </h1>
                <div className='text-muted-foreground mt-2 flex items-center gap-1.5 text-[15px]'>
                  <span className='tabular-nums'>
                    {t('Account ID')}：{profile?.uid || '-'}
                  </span>
                  {profile?.uid && (
                    <button
                      type='button'
                      onClick={handleCopyUid}
                      className='hover:text-foreground -m-1 cursor-pointer p-1 transition-colors'
                      aria-label={t('Copy')}
                    >
                      {copied ? (
                        <Check className='size-4 text-emerald-600' />
                      ) : (
                        <Copy className='size-4' />
                      )}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
