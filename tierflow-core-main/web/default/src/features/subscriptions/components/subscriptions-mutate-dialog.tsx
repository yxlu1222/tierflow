/*
Copyright (C) 2023-2026 TierFlow
*/
import { forwardRef, useEffect, useState, type ComponentProps } from 'react'
import {
  useForm,
  type Resolver,
  type SubmitErrorHandler,
} from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarClock, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getPlanModelSets,
  type PlanModelSet,
} from '@/features/plan-model-sets/api'
import { createPlan, updatePlan, getGroups } from '../api'
import { getDurationUnitOptions, getResetPeriodOptions } from '../constants'
import {
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
  formValuesToPlanPayload,
  type PlanFormValues,
} from '../lib'
import type { PlanRecord } from '../types'
import { useSubscriptions } from './subscriptions-provider'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: PlanRecord
}

type MutateTab = 'basic' | 'duration'

// Which tab each field lives on — used to jump to the first tab with a
// validation error when the user submits from another tab.
const FIELD_TAB: Record<keyof PlanFormValues, MutateTab> = {
  title: 'basic',
  subtitle: 'basic',
  price_amount: 'basic',
  total_amount: 'basic',
  basic_token_total: 'basic',
  basic_unlimited: 'basic',
  premium_set_id: 'basic',
  basic_set_id: 'basic',
  upgrade_group: 'basic',
  max_purchase_per_user: 'basic',
  sort_order: 'basic',
  enabled: 'basic',
  recommended: 'basic',
  allow_balance_pay: 'basic',
  duration_unit: 'duration',
  duration_value: 'duration',
  custom_seconds: 'duration',
  quota_reset_period: 'duration',
  quota_reset_custom_seconds: 'duration',
}

const TAB_ORDER: MutateTab[] = ['basic', 'duration']

// 金额/额度数字输入框。
// 关键:用本地字符串 state 直接驱动显示,清空时 setText('') 同步生效,
// 不依赖 RHF Controller / base-ui 受控 number 输入的重渲染时序——否则默认值
// (如 0)会在删空后被旧值刷回,导致"删不掉"。空串 => undefined 交给表单校验。
type MoneyNumberInputProps = {
  value: number | undefined
  onChange: (v: number | undefined) => void
  onBlur?: () => void
  disabled?: boolean
  step?: string
} & Omit<
  ComponentProps<typeof Input>,
  'value' | 'onChange' | 'onBlur' | 'type' | 'ref'
>

const MoneyNumberInput = forwardRef<HTMLInputElement, MoneyNumberInputProps>(
  function MoneyNumberInput(
    { value, onChange, onBlur, disabled, step, ...rest },
    ref
  ) {
    const [text, setText] = useState(() =>
      value == null ? '' : String(value)
    )
    // 渲染期同步:仅当外部 value(表单值)真正变化、且与当前文本不一致时,
    // 才用外部值刷新本地文本。用户输入产生的 value 变化不会打断输入,
    // 因为那时 text 解析结果已等于 value。参见 React「基于 props 调整 state」。
    const [prevValue, setPrevValue] = useState(value)
    if (value !== prevValue) {
      setPrevValue(value)
      const parsed = text === '' ? undefined : Number(text)
      if (parsed !== value) {
        setText(value == null ? '' : String(value))
      }
    }

    return (
      <Input
        {...rest}
        ref={ref}
        type='number'
        step={step}
        min={0}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          onChange(next === '' ? undefined : Number(next))
        }}
        onBlur={onBlur}
      />
    )
  }
)

export function SubscriptionsMutateDialog({
  open,
  onOpenChange,
  currentRow,
}: Props) {
  const { t } = useTranslation()
  const isEdit = !!currentRow?.plan?.id
  const { triggerRefresh } = useSubscriptions()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<MutateTab>('basic')
  const [groupOptions, setGroupOptions] = useState<string[]>([])
  // 套餐模型组选项(premium/basic set 下拉)
  const [planSets, setPlanSets] = useState<PlanModelSet[]>([])
  const planSetItems = [
    { value: '0', label: t('Not configured') },
    ...planSets.map((s) => ({ value: String(s.id), label: s.name })),
  ]

  const schema = getPlanFormSchema(t)
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<PlanFormValues>,
    defaultValues: PLAN_FORM_DEFAULTS,
  })

  useEffect(() => {
    if (open) {
      setActiveTab('basic')
      if (currentRow?.plan) {
        form.reset(planToFormValues(currentRow.plan))
      } else {
        form.reset(PLAN_FORM_DEFAULTS)
      }
      getGroups()
        .then((res) => {
          if (res.success) setGroupOptions(res.data || [])
        })
        .catch(() => {})
      getPlanModelSets()
        .then((res) => {
          if (res.success) setPlanSets(res.data || [])
        })
        .catch(() => {})
    }
  }, [open, currentRow, form])

  const durationUnit = form.watch('duration_unit')
  const resetPeriod = form.watch('quota_reset_period')

  const onSubmit = async (values: PlanFormValues) => {
    setIsSubmitting(true)
    try {
      const payload = formValuesToPlanPayload(values)
      if (isEdit && currentRow?.plan?.id) {
        const res = await updatePlan(currentRow.plan.id, payload)
        if (res.success) {
          toast.success(t('Update succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      } else {
        const res = await createPlan(payload)
        if (res.success) {
          toast.success(t('Create succeeded'))
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setIsSubmitting(false)
    }
  }

  // Surface validation on the tab that owns the first offending field, so
  // errors on a hidden tab aren't silently swallowed.
  const onInvalid: SubmitErrorHandler<PlanFormValues> = (errors) => {
    const firstField = TAB_ORDER.map((tab) =>
      (Object.keys(errors) as (keyof PlanFormValues)[]).find(
        (key) => FIELD_TAB[key] === tab
      )
    ).find(Boolean)
    if (firstField) setActiveTab(FIELD_TAB[firstField])
  }

  const durationUnitOpts = getDurationUnitOptions(t)
  const resetPeriodOpts = getResetPeriodOptions(t)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Prevent closing mid-save (e.g. clicking outside) to avoid partial writes.
        if (isSubmitting && !next) return
        onOpenChange(next)
        if (!next) form.reset()
      }}
    >
      <DialogContent className='flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Update plan info') : t('Create new subscription plan')}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('Modify existing subscription plan configuration')
              : t(
                  'Fill in the following info to create a new subscription plan'
                )}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MutateTab)}
          className='min-h-0 flex-1'
        >
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='basic'>{t('Basic Info')}</TabsTrigger>
            <TabsTrigger value='duration'>{t('Duration Settings')}</TabsTrigger>
          </TabsList>

          <Form {...form}>
            <form
              id='subscription-form'
              onSubmit={form.handleSubmit(onSubmit, onInvalid)}
              className='min-h-0 flex-1 overflow-y-auto'
            >
              {/* Basic Info */}
              <TabsContent
                value='basic'
                keepMounted
                className='mt-0 flex flex-col gap-4 py-1'
              >
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Title')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('e.g. Basic Plan')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name='subtitle'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Plan Subtitle')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('e.g. Suitable for light usage')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='price_amount'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Actual Amount')}</FormLabel>
                        <FormControl>
                          <MoneyNumberInput
                            name={field.name}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            step='0.01'
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='total_amount'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Premium model credit')}</FormLabel>
                        <FormControl>
                          <MoneyNumberInput
                            name={field.name}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            step='0.01'
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'CNY credit for the premium bucket, converted to quota when saved. 0 = unlimited (legacy).'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* 基础模型桶:token 总量 + 无限开关 */}
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='basic_token_total'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Basic model tokens')}</FormLabel>
                        <FormControl>
                          <MoneyNumberInput
                            name={field.name}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            disabled={form.watch('basic_unlimited')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Token amount for the basic bucket. 0 = no basic bucket.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='basic_unlimited'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between rounded-lg border px-3 py-2'>
                        <FormLabel className='text-sm font-normal'>
                          {t('Unlimited basic tokens')}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {/* 双桶各自的套餐模型组 */}
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='premium_set_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Premium model set')}</FormLabel>
                        <Select
                          items={planSetItems}
                          value={String(field.value || 0)}
                          onValueChange={(v) => field.onChange(Number(v) || 0)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {planSetItems.map((it) => (
                                <SelectItem key={it.value} value={it.value}>
                                  {it.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name='basic_set_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Basic model set')}</FormLabel>
                        <Select
                          items={planSetItems}
                          value={String(field.value || 0)}
                          onValueChange={(v) => field.onChange(Number(v) || 0)}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {planSetItems.map((it) => (
                                <SelectItem key={it.value} value={it.value}>
                                  {it.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='upgrade_group'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Upgrade Group')}</FormLabel>
                        <Select
                          items={[
                            { value: '__none__', label: t('No Upgrade') },
                            ...groupOptions.map((g) => ({
                              value: g,
                              label: g,
                            })),
                          ]}
                          onValueChange={(v) =>
                            field.onChange(v === '__none__' ? '' : v)
                          }
                          value={field.value || ''}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('No Upgrade')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              <SelectItem value='__none__'>
                                {t('No Upgrade')}
                              </SelectItem>
                              {groupOptions.map((g) => (
                                <SelectItem key={g} value={g}>
                                  {g}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='max_purchase_per_user'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Purchase Limit')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            min={0}
                            onChange={(e) =>
                              field.onChange(parseInt(e.target.value, 10) || 0)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {t('0 means unlimited')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name='sort_order'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Sort Order')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value, 10) || 0)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='enabled'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between gap-3 rounded-lg border p-3'>
                        <FormLabel className='!mt-0'>
                          {t('Enabled Status')}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='allow_balance_pay'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between gap-3 rounded-lg border p-3'>
                        <FormLabel className='!mt-0'>
                          {t('Allow balance redemption')}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* 推荐标记:套餐页/充值页以蓝色描边 + 「推荐」徽章高亮该档 */}
                  <FormField
                    control={form.control}
                    name='recommended'
                    render={({ field }) => (
                      <FormItem className='flex flex-row items-center justify-between gap-3 rounded-lg border p-3'>
                        <FormLabel className='!mt-0'>
                          {t('Recommended')}
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </TabsContent>

              {/* Duration & Quota Reset */}
              <TabsContent
                value='duration'
                keepMounted
                className='mt-0 flex flex-col gap-6 py-1'
              >
                <div className='flex flex-col gap-4'>
                  <h3 className='flex items-center gap-2 text-sm font-medium'>
                    <CalendarClock className='h-4 w-4' />
                    {t('Duration Settings')}
                  </h3>

                  <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='duration_unit'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Duration Unit')}</FormLabel>
                          <Select
                            items={[
                              ...durationUnitOpts.map((o) => ({
                                value: o.value,
                                label: o.label,
                              })),
                            ]}
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {durationUnitOpts.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {durationUnit === 'custom' ? (
                      <FormField
                        control={form.control}
                        name='custom_seconds'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Custom Seconds')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type='number'
                                min={1}
                                onChange={(e) =>
                                  field.onChange(
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <FormField
                        control={form.control}
                        name='duration_value'
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('Duration Value')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                type='number'
                                min={1}
                                onChange={(e) =>
                                  field.onChange(
                                    parseInt(e.target.value, 10) || 0
                                  )
                                }
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </div>

                <div className='flex flex-col gap-4'>
                  <h3 className='flex items-center gap-2 text-sm font-medium'>
                    <RefreshCw className='h-4 w-4' />
                    {t('Quota Reset')}
                  </h3>

                  <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                    <FormField
                      control={form.control}
                      name='quota_reset_period'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Reset Cycle')}</FormLabel>
                          <Select
                            items={[
                              ...resetPeriodOpts.map((o) => ({
                                value: o.value,
                                label: o.label,
                              })),
                            ]}
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {resetPeriodOpts.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>
                                    {o.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name='quota_reset_custom_seconds'
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('Custom Seconds')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type='number'
                              min={0}
                              disabled={resetPeriod !== 'custom'}
                              onChange={(e) =>
                                field.onChange(
                                  parseInt(e.target.value, 10) || 0
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </TabsContent>
            </form>
          </Form>
        </Tabs>

        <DialogFooter>
          <DialogClose
            render={<Button variant='outline' disabled={isSubmitting} />}
          >
            {t('Close')}
          </DialogClose>
          <Button
            form='subscription-form'
            type='submit'
            disabled={isSubmitting}
          >
            {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
