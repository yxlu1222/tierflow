/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useRef } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { parseHttpStatusCodeRules } from '@/lib/http-status-code-rules'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

const makeHighAvailabilitySchema = (t: TFunction) =>
  z
    .object({
      RouteBreakerEnabled: z.boolean(),
      BreakerKeyLevelEnabled: z.boolean(),
      BreakerFailureThreshold: z.coerce
        .number()
        .int()
        .min(1, t('Must be at least 1')),
      BreakerWindowSeconds: z.coerce
        .number()
        .int()
        .min(1, t('Must be at least 1')),
      BreakerCooldownSeconds: z.coerce
        .number()
        .int()
        .min(1, t('Must be at least 1')),
      BreakerMaxCooldownSeconds: z.coerce
        .number()
        .int()
        .min(1, t('Must be at least 1')),
      BreakerTripStatusCodes: z.string(),
    })
    .superRefine((values, ctx) => {
      const parsed = parseHttpStatusCodeRules(values.BreakerTripStatusCodes)
      if (!parsed.ok) {
        ctx.addIssue({
          code: 'custom',
          path: ['BreakerTripStatusCodes'],
          message: t('Invalid status code rules: {{tokens}}', {
            tokens: parsed.invalidTokens.join(', '),
          }),
        })
      }
      if (values.BreakerMaxCooldownSeconds < values.BreakerCooldownSeconds) {
        ctx.addIssue({
          code: 'custom',
          path: ['BreakerMaxCooldownSeconds'],
          message: t('Max cooldown must be >= base cooldown'),
        })
      }
    })

type HighAvailabilitySchema = ReturnType<typeof makeHighAvailabilitySchema>
type HighAvailabilityFormValues = z.output<HighAvailabilitySchema>
type HighAvailabilityFormInput = z.input<HighAvailabilitySchema>

type HighAvailabilitySectionProps = {
  defaultValues: {
    RouteBreakerEnabled: boolean
    BreakerKeyLevelEnabled: boolean
    BreakerFailureThreshold: number
    BreakerWindowSeconds: number
    BreakerCooldownSeconds: number
    BreakerMaxCooldownSeconds: number
    BreakerTripStatusCodes: string
  }
}

type NormalizedValues = HighAvailabilitySectionProps['defaultValues']

const buildFormDefaults = (
  defaults: NormalizedValues
): HighAvailabilityFormInput => ({
  RouteBreakerEnabled: defaults.RouteBreakerEnabled,
  BreakerKeyLevelEnabled: defaults.BreakerKeyLevelEnabled,
  BreakerFailureThreshold: defaults.BreakerFailureThreshold,
  BreakerWindowSeconds: defaults.BreakerWindowSeconds,
  BreakerCooldownSeconds: defaults.BreakerCooldownSeconds,
  BreakerMaxCooldownSeconds: defaults.BreakerMaxCooldownSeconds,
  BreakerTripStatusCodes: defaults.BreakerTripStatusCodes ?? '',
})

const normalizeDefaults = (defaults: NormalizedValues): NormalizedValues => ({
  ...defaults,
  BreakerTripStatusCodes: parseHttpStatusCodeRules(
    defaults.BreakerTripStatusCodes ?? ''
  ).normalized,
})

const normalizeFormValues = (
  values: HighAvailabilityFormValues
): NormalizedValues => ({
  RouteBreakerEnabled: values.RouteBreakerEnabled,
  BreakerKeyLevelEnabled: values.BreakerKeyLevelEnabled,
  BreakerFailureThreshold: values.BreakerFailureThreshold,
  BreakerWindowSeconds: values.BreakerWindowSeconds,
  BreakerCooldownSeconds: values.BreakerCooldownSeconds,
  BreakerMaxCooldownSeconds: values.BreakerMaxCooldownSeconds,
  BreakerTripStatusCodes: parseHttpStatusCodeRules(
    values.BreakerTripStatusCodes
  ).normalized,
})

export function HighAvailabilitySection({
  defaultValues,
}: HighAvailabilitySectionProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<NormalizedValues>(normalizeDefaults(defaultValues))

  const schema = useMemo(() => makeHighAvailabilitySchema(t), [t])

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    HighAvailabilityFormInput,
    unknown,
    HighAvailabilityFormValues
  >({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const tripStatusCodes = form.watch('BreakerTripStatusCodes')
  const tripParsed = useMemo(
    () => parseHttpStatusCodeRules(tripStatusCodes),
    [tripStatusCodes]
  )

  const onSubmit = async (values: HighAvailabilityFormValues) => {
    const normalized = normalizeFormValues(values)
    const updates = (
      Object.keys(normalized) as Array<keyof NormalizedValues>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of updates) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }

    baselineRef.current = normalized
  }

  return (
    <SettingsSection title={t('High Availability Routing')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save high availability settings'
          />

          <div className='grid gap-6 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='RouteBreakerEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Circuit breaker')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Temporarily cool down a channel after transient upstream failures (429 / 5xx), then automatically probe and recover.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />

            <FormField
              control={form.control}
              name='BreakerKeyLevelEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Per-key cooldown')}</FormLabel>
                    <FormDescription>
                      {t(
                        'For multi-key channels, cool down the individual failing key so traffic shifts to healthy keys.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
          </div>

          <div className='grid gap-6 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='BreakerFailureThreshold'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Failure threshold')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Consecutive failures within the window before the channel/key trips.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='BreakerWindowSeconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Failure window (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Rolling window over which failures are counted.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className='grid gap-6 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='BreakerCooldownSeconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Cooldown (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Base cooldown after a trip. Doubles on each repeated trip.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='BreakerMaxCooldownSeconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max cooldown (seconds)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={1}
                      step={1}
                      {...safeNumberFieldProps(field)}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Upper bound for the exponential cooldown backoff.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='BreakerTripStatusCodes'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Trip status codes')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('e.g. 429, 500-504, 520-599')}
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Status codes treated as transient failures that cool the channel down (separate from auto-disable).'
                  )}{' '}
                  {tripParsed.ok &&
                    tripParsed.normalized &&
                    tripParsed.normalized !== field.value.trim() && (
                      <span className='text-muted-foreground'>
                        {t('Normalized:')} {tripParsed.normalized}
                      </span>
                    )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
