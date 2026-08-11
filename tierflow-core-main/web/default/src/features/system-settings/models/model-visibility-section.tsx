/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

export function ModelVisibilitySection({
  defaultValues,
}: {
  defaultValues: {
    exposeUpstream: boolean
    restrictDirect: boolean
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [expose, setExpose] = useState(!!defaultValues.exposeUpstream)
  const [restrict, setRestrict] = useState(!!defaultValues.restrictDirect)
  const onToggle = async (v: boolean) => {
    setExpose(v)
    try {
      await updateOption.mutateAsync({
        key: 'ExposeUpstreamModels',
        value: String(v),
      })
      toast.success(t('Saved'))
    } catch {
      setExpose(!v) // 回滚
    }
  }

  const onToggleRestrict = async (v: boolean) => {
    setRestrict(v)
    try {
      await updateOption.mutateAsync({
        key: 'RestrictDirectModelCall',
        value: String(v),
      })
      toast.success(t('Saved'))
    } catch {
      setRestrict(!v) // 回滚
    }
  }

  return (
    <SettingsSection title={t('Model Visibility')}>
      <Alert variant='default'>
        <AlertTitle>{t('User-facing model list')}</AlertTitle>
        <AlertDescription>
          {t(
            'When off, users only see routing aliases (e.g. auto) in /v1/models; the underlying upstream models are hidden. Turn on to also expose all upstream models to users.'
          )}
        </AlertDescription>
      </Alert>

      <div className='flex items-center justify-between gap-4 rounded-lg border p-4'>
        <div className='space-y-0.5'>
          <div className='font-medium'>
            {t('Expose upstream models to users')}
          </div>
          <div className='text-muted-foreground text-sm'>
            {t('Default off: users see only routing aliases.')}
          </div>
        </div>
        <Switch
          checked={expose}
          onCheckedChange={onToggle}
          disabled={updateOption.isPending}
        />
      </div>

      <div className='flex items-center justify-between gap-4 rounded-lg border p-4'>
        <div className='space-y-0.5'>
          <div className='font-medium'>
            {t('Restrict direct model calls')}
          </div>
          <div className='text-muted-foreground text-sm'>
            {t(
              'When on, non-admin users can only call routing aliases; requesting an upstream model by name is rejected.'
            )}
          </div>
        </div>
        <Switch
          checked={restrict}
          onCheckedChange={onToggleRestrict}
          disabled={updateOption.isPending}
        />
      </div>
    </SettingsSection>
  )
}
