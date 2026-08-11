/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo, useRef } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  SettingsControlGroup,
  SettingsForm,
  SettingsFormGridItem,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { safeNumberFieldProps } from '../utils/numeric-field'

/**
 * IMPORTANT: react-hook-form 7 把带点的 `name` 当成嵌套路径。若 schema 直接用
 * 扁平的 `'message_capture_setting.enabled'` 作字面 key，表单状态会与 zod 校验的
 * 结构错开，保存会静默变成 no-op。所以内部用真正的嵌套对象建模，只在落库前
 * 拍平回服务端的 key 形态。(与 performance-section.tsx 同一处理，见那里的注释)
 */
const messageCaptureSchema = z.object({
  message_capture_setting: z.object({
    enabled: z.boolean(),
    dir: z.string().min(1),
    quota_per_day: z.coerce.number().int().min(1),
    max_content_bytes: z.coerce.number().int().min(1024),
    max_tee_bytes: z.coerce.number().int().min(1024),
    max_req_body_bytes: z.coerce.number().int().min(1024),
    max_replay_messages: z.coerce.number().int().min(1),
    queue_size: z.coerce.number().int().min(1),
    exclude_user_ids: z.string(),
  }),
})

type MessageCaptureFormInput = z.input<typeof messageCaptureSchema>
type MessageCaptureFormValues = z.output<typeof messageCaptureSchema>

type FlatMessageCaptureDefaults = {
  'message_capture_setting.enabled': boolean
  'message_capture_setting.dir': string
  'message_capture_setting.quota_per_day': number
  'message_capture_setting.max_content_bytes': number
  'message_capture_setting.max_tee_bytes': number
  'message_capture_setting.max_req_body_bytes': number
  'message_capture_setting.max_replay_messages': number
  'message_capture_setting.queue_size': number
  'message_capture_setting.exclude_user_ids': string
}

const buildFormDefaults = (
  defaults: FlatMessageCaptureDefaults
): MessageCaptureFormInput => ({
  message_capture_setting: {
    enabled: defaults['message_capture_setting.enabled'],
    dir: defaults['message_capture_setting.dir'] ?? 'messages',
    quota_per_day: defaults['message_capture_setting.quota_per_day'],
    max_content_bytes: defaults['message_capture_setting.max_content_bytes'],
    max_tee_bytes: defaults['message_capture_setting.max_tee_bytes'],
    max_req_body_bytes: defaults['message_capture_setting.max_req_body_bytes'],
    max_replay_messages:
      defaults['message_capture_setting.max_replay_messages'],
    queue_size: defaults['message_capture_setting.queue_size'],
    exclude_user_ids:
      defaults['message_capture_setting.exclude_user_ids'] ?? '',
  },
})

const normalizeFormValues = (
  values: MessageCaptureFormValues
): FlatMessageCaptureDefaults => ({
  'message_capture_setting.enabled': values.message_capture_setting.enabled,
  'message_capture_setting.dir': values.message_capture_setting.dir,
  'message_capture_setting.quota_per_day':
    values.message_capture_setting.quota_per_day,
  'message_capture_setting.max_content_bytes':
    values.message_capture_setting.max_content_bytes,
  'message_capture_setting.max_tee_bytes':
    values.message_capture_setting.max_tee_bytes,
  'message_capture_setting.max_req_body_bytes':
    values.message_capture_setting.max_req_body_bytes,
  'message_capture_setting.max_replay_messages':
    values.message_capture_setting.max_replay_messages,
  'message_capture_setting.queue_size':
    values.message_capture_setting.queue_size,
  'message_capture_setting.exclude_user_ids':
    values.message_capture_setting.exclude_user_ids ?? '',
})

type Props = {
  defaultValues: FlatMessageCaptureDefaults
}

export function MessageCaptureSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()

  const formDefaults = useMemo(
    () => buildFormDefaults(defaultValues),
    [defaultValues]
  )

  const form = useForm<
    MessageCaptureFormInput,
    unknown,
    MessageCaptureFormValues
  >({
    resolver: zodResolver(messageCaptureSchema),
    defaultValues: formDefaults,
  })

  const baselineRef = useRef<FlatMessageCaptureDefaults>(defaultValues)
  const baselineSerializedRef = useRef<string>(JSON.stringify(defaultValues))

  useEffect(() => {
    const serialized = JSON.stringify(defaultValues)
    if (serialized === baselineSerializedRef.current) return
    baselineRef.current = defaultValues
    baselineSerializedRef.current = serialized
    form.reset(buildFormDefaults(defaultValues))
  }, [defaultValues, form])

  const enabled = form.watch('message_capture_setting.enabled')

  const onSubmit = async (values: MessageCaptureFormValues) => {
    const normalized = normalizeFormValues(values)
    const changedKeys = (
      Object.keys(normalized) as Array<keyof FlatMessageCaptureDefaults>
    ).filter((key) => normalized[key] !== baselineRef.current[key])

    if (changedKeys.length === 0) {
      toast.info(t('No changes to save'))
      return
    }

    for (const key of changedKeys) {
      await updateOption.mutateAsync({ key, value: normalized[key] })
    }

    baselineRef.current = normalized
    baselineSerializedRef.current = JSON.stringify(normalized)
    form.reset(buildFormDefaults(normalized))
  }

  return (
    <SettingsSection title={t('Conversation Message Capture')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            saveLabel='Save capture settings'
          />

          <FormField
            control={form.control}
            name='message_capture_setting.enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Record conversation messages')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Write the conversation content passing through the gateway to JSONL files, grouped by user and date, for usage analysis. Takes effect immediately — no restart needed.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </SettingsSwitchItem>
            )}
          />

          {enabled ? (
            <Alert data-settings-form-span='full'>
              <AlertDescription>
                {t(
                  'Message content is stored in plain text on the server disk. Make sure this is covered by your privacy policy and that the storage directory is backed up and access-controlled accordingly.'
                )}
              </AlertDescription>
            </Alert>
          ) : null}

          <SettingsControlGroup className='space-y-4'>
            <FormField
              control={form.control}
              name='message_capture_setting.dir'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Storage directory')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='messages' />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Relative paths resolve against the process working directory. Only newly opened files use the new path; handles already open keep appending to the old one until they are recycled.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='message_capture_setting.exclude_user_ids'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Excluded user IDs')}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='1,2,3' />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Comma-separated internal user IDs whose conversations are never recorded.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsControlGroup>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.quota_per_day'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Messages per user per day')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Upper bound on recorded messages per user per day. A request is recorded all-or-nothing, so a turn that does not fit is skipped entirely.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.max_replay_messages'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max replayed history messages')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'When a conversation cursor is missed, only this many trailing history messages are re-recorded. The effective value is further capped below the daily quota so a turn always fits.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.max_content_bytes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max bytes per message')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1024} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Message text longer than this is truncated and flagged as truncated.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.max_req_body_bytes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max request body bytes')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1024} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Requests with a larger body are skipped entirely rather than truncated — a truncated body is invalid JSON and cannot be parsed. Set this above the largest conversation history you expect.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.max_tee_bytes'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Max response buffer bytes')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1024} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Budget for copying the streamed response. Estimate against raw SSE bytes, not text length: streaming inflates roughly 26x, so this must stay well above the per-message text limit.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>

          <SettingsFormGridItem>
            <FormField
              control={form.control}
              name='message_capture_setting.queue_size'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Async queue size')}</FormLabel>
                  <FormControl>
                    <Input type='number' min={1} {...safeNumberFieldProps(field)} />
                  </FormControl>
                  <FormDescription>
                    {t(
                      'Capacity of the async write queue; tasks are dropped when it is full. Requires a restart to take effect — the queue is created once at startup.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsFormGridItem>
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
