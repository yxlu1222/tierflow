/*
Copyright (C) 2023-2026 TierFlow
*/
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

const schema = z.object({
  url: z.string().optional(),
  secret: z.string().optional(),
  timeoutMs: z.coerce.number().int().min(0).optional(),
})

type Values = z.input<typeof schema>

export function InferenceSettingsSection({
  defaultValues,
}: {
  defaultValues: {
    url: string
    secret: string
    timeoutMs: number
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      url: defaultValues.url ?? '',
      secret: defaultValues.secret ?? '',
      timeoutMs: defaultValues.timeoutMs ?? 10000,
    },
  })

  const { isDirty, isSubmitting } = form.formState

  async function onSubmit(values: Values) {
    const updates: Array<{ key: string; value: string }> = []

    if ((values.url || '') !== (defaultValues.url || '')) {
      updates.push({ key: 'inference.url', value: String(values.url || '') })
    }
    if ((values.secret || '') !== (defaultValues.secret || '')) {
      updates.push({
        key: 'inference.secret',
        value: String(values.secret || ''),
      })
    }
    const nextTimeout = Number(values.timeoutMs ?? 10000)
    if (nextTimeout !== Number(defaultValues.timeoutMs ?? 10000)) {
      updates.push({
        key: 'inference.timeout_ms',
        value: String(nextTimeout),
      })
    }

    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const update of updates) {
      await updateOption.mutateAsync(update)
    }

    form.reset(values)
  }

  return (
    <SettingsSection title={t('Inference Service')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save inference settings'
          />

          <Alert variant='default'>
            <AlertTitle>
              {t('TierFlow smart-routing inference service')}
            </AlertTitle>
            <AlertDescription>
              {t(
                'Used by auto-routing to score request difficulty. Leave blank to fall back to the INFERENCE_SERVICE_* environment variables; empty means auto-routing uses the tier-3 fallback model.'
              )}
            </AlertDescription>
          </Alert>

          <FormField
            control={form.control}
            name='url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Inference Service URL')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder='http://inference:8001'
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Base URL of tierflow-infer; requests are sent to {url}/internal/v1/classify'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='secret'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Inference Service Secret')}</FormLabel>
                <FormControl>
                  <Input
                    type='password'
                    placeholder={t('X-Inference-Secret header value')}
                    autoComplete='off'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Must match the secret the infer service was started with'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='timeoutMs'
            render={({ field }) => {
              // schema 用了 z.coerce.number(),其 input 类型是 unknown
              // (coerce 接受任意输入再转换),而 Values = z.input<typeof schema>,
              // 故此处需把 value 收窄成受控 input 能接受的类型。
              const { value, ...rest } = field
              return (
                <FormItem>
                  <FormLabel>{t('Inference Timeout (ms)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      min={0}
                      placeholder='10000'
                      {...rest}
                      value={
                        typeof value === 'number' || typeof value === 'string'
                          ? value
                          : ''
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )
            }}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
