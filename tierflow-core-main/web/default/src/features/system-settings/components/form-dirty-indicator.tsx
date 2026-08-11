/*
Copyright (C) 2023-2026 TierFlow
*/
import { useTranslation } from 'react-i18next'
import { SettingsPageTitleStatusPortal } from './settings-page-context'

type FormDirtyIndicatorProps = {
  isDirty: boolean
  message?: string
}

/**
 * Compact page-title status indicator for unsaved form changes.
 *
 * @example
 * ```tsx
 * <FormDirtyIndicator isDirty={form.formState.isDirty} />
 * ```
 */
export function FormDirtyIndicator({
  isDirty,
  message,
}: FormDirtyIndicatorProps) {
  const { t } = useTranslation()
  if (!isDirty) return null

  return (
    <SettingsPageTitleStatusPortal>
      <span className='inline-flex h-5 items-center gap-1.5 rounded-full bg-amber-500/10 px-2 text-[11px] font-medium whitespace-nowrap text-amber-700 ring-1 ring-amber-500/20 ring-inset'>
        <span className='size-1.5 rounded-full bg-amber-500' />
        {message ? t(message) : t('Unsaved changes')}
      </span>
    </SettingsPageTitleStatusPortal>
  )
}
