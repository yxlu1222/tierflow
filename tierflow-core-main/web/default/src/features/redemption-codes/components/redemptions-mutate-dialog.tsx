/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getCurrencyDisplay, getCurrencyLabel } from '@/lib/currency'
import { addTimeToDate } from '@/lib/time'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
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
import { DateTimePicker } from '@/components/datetime-picker'
import { getAdminPlans } from '@/features/subscriptions/api'
import { createRedemption, updateRedemption, getRedemption } from '../api'
import {
  REDEMPTION_TYPE,
  SUCCESS_MESSAGES,
  getRedemptionTypeOptions,
} from '../constants'
import {
  getRedemptionFormSchema,
  type RedemptionFormValues,
  REDEMPTION_FORM_DEFAULT_VALUES,
  transformFormDataToPayload,
  transformRedemptionToFormDefaults,
} from '../lib'
import { type Redemption } from '../types'
import { useRedemptions } from './redemptions-provider'

type RedemptionsMutateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: Redemption
}

export function RedemptionsMutateDialog({
  open,
  onOpenChange,
  currentRow,
}: RedemptionsMutateDialogProps) {
  const { t } = useTranslation()
  const isUpdate = !!currentRow
  const { triggerRefresh } = useRedemptions()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<RedemptionFormValues>({
    resolver: zodResolver(getRedemptionFormSchema(t)),
    defaultValues: REDEMPTION_FORM_DEFAULT_VALUES,
  })

  const codeType = form.watch('type')
  const isSubscriptionCode = codeType === REDEMPTION_TYPE.SUBSCRIPTION

  // 用管理端接口而非 public_plans：管理员可能先建码、后启用套餐，
  // 下拉里必须能看到停用的套餐（并标注出来）。
  const { data: plansData } = useQuery({
    queryKey: ['redemption-codes', 'admin-plans'],
    queryFn: getAdminPlans,
    enabled: open && isSubscriptionCode,
  })

  const planOptions = useMemo(
    () => (plansData?.data || []).map((record) => record.plan),
    [plansData?.data]
  )

  // Load existing data when updating
  useEffect(() => {
    if (open && isUpdate && currentRow) {
      // For update, fetch fresh data
      getRedemption(currentRow.id).then((result) => {
        if (result.success && result.data) {
          form.reset(transformRedemptionToFormDefaults(result.data))
        }
      })
    } else if (open && !isUpdate) {
      // For create, reset to defaults
      form.reset(REDEMPTION_FORM_DEFAULT_VALUES)
    }
  }, [open, isUpdate, currentRow, form])

  const onSubmit = async (data: RedemptionFormValues) => {
    setIsSubmitting(true)
    try {
      const basePayload = transformFormDataToPayload(data)

      if (isUpdate && currentRow) {
        const result = await updateRedemption({
          ...basePayload,
          id: currentRow.id,
        })
        if (result.success) {
          toast.success(t(SUCCESS_MESSAGES.REDEMPTION_UPDATED))
          onOpenChange(false)
          triggerRefresh()
        }
      } else {
        // Create mode
        const result = await createRedemption(basePayload)
        if (result.success) {
          const count = result.data?.length || 0
          toast.success(
            count > 1
              ? t('Successfully created {{count}} redemption codes', {
                  count,
                })
              : t(SUCCESS_MESSAGES.REDEMPTION_CREATED)
          )
          onOpenChange(false)
          triggerRefresh()
        }
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSetExpiry = (months: number, days: number, hours: number) => {
    const newDate = addTimeToDate(months, days, hours)
    form.setValue('expired_time', newDate)
  }

  const { meta: currencyMeta } = getCurrencyDisplay()
  const currencyLabel = getCurrencyLabel()
  const tokensOnly = currencyMeta.kind === 'tokens'
  const quotaLabel = t('Quota ({{currency}})', { currency: currencyLabel })
  const quotaPlaceholder = tokensOnly
    ? t('Enter quota in tokens')
    : t('Enter quota in {{currency}}', { currency: currencyLabel })

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v)
        if (!v) {
          form.reset()
        }
      }}
    >
      {/* sm:p-0 不能省：DialogContent 默认带 `p-5 sm:p-6`，只写 p-0 覆盖不掉
          断点类，桌面端会残留 24px 外层内边距，导致各区块边距不对称。 */}
      <DialogContent className='flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[600px] sm:p-0'>
        <DialogHeader className='flex-shrink-0 border-b p-4 text-start'>
          <DialogTitle>
            {isUpdate
              ? t('Update Redemption Code')
              : t('Create Redemption Code')}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form
            id='redemption-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='min-h-0 flex-1 overflow-y-auto p-4'
          >
            <div className='space-y-4'>
              <FormField
                control={form.control}
                name='name'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Name')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('Enter a name')} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 类型与额度/套餐并排：两者关联紧密，同行更易对照 */}
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <FormField
                  control={form.control}
                  name='type'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Code Type')}</FormLabel>
                      <FormControl>
                        <Select
                          items={getRedemptionTypeOptions(t)}
                          value={String(field.value)}
                          onValueChange={(v) =>
                            v !== null && field.onChange(Number(v))
                          }
                        >
                          <SelectTrigger className='w-full'>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {getRedemptionTypeOptions(t).map((option) => (
                                <SelectItem
                                  key={option.value}
                                  value={option.value}
                                >
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        {t(
                          'Quota codes add wallet balance; subscription codes activate a plan'
                        )}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isSubscriptionCode ? (
                  <FormField
                    control={form.control}
                    name='plan_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Subscription Plan')}</FormLabel>
                        <FormControl>
                          <Select
                            items={planOptions.map((plan) => ({
                              value: String(plan.id),
                              label: plan.title,
                            }))}
                            value={
                              field.value ? String(field.value) : undefined
                            }
                            onValueChange={(v) =>
                              v !== null && field.onChange(Number(v))
                            }
                          >
                            <SelectTrigger className='w-full'>
                              <SelectValue
                                placeholder={t('Select subscription plan')}
                              />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {planOptions.map((plan) => (
                                  <SelectItem
                                    key={plan.id}
                                    value={String(plan.id)}
                                  >
                                    {plan.title}（¥
                                    {Number(plan.price_amount || 0).toFixed(2)}
                                    ）{!plan.enabled && ` · ${t('Disabled')}`}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t(
                            'The plan this code activates. Redeeming fails while the plan is disabled.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name='quota_dollars'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{quotaLabel}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type='number'
                            step={tokensOnly ? 1 : 0.01}
                            placeholder={quotaPlaceholder}
                            onChange={(e) =>
                              field.onChange(parseFloat(e.target.value) || 0)
                            }
                          />
                        </FormControl>
                        <FormDescription>
                          {tokensOnly
                            ? t('Enter the quota amount in tokens')
                            : t('Enter the quota amount in {{currency}}', {
                                currency: currencyLabel,
                              })}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              <FormField
                control={form.control}
                name='expired_time'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Expiration Time')}</FormLabel>
                    <div className='flex flex-col gap-2'>
                      <FormControl>
                        <DateTimePicker
                          value={field.value}
                          onChange={field.onChange}
                          placeholder={t('Never expires')}
                        />
                      </FormControl>
                      <div className='grid grid-cols-4 gap-1.5 sm:flex sm:gap-2'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => handleSetExpiry(0, 0, 0)}
                        >
                          {t('Never')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => handleSetExpiry(1, 0, 0)}
                        >
                          {t('1M')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => handleSetExpiry(0, 7, 0)}
                        >
                          {t('1W')}
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => handleSetExpiry(0, 1, 0)}
                        >
                          {t('1 Day')}
                        </Button>
                      </div>
                    </div>
                    <FormDescription>
                      {t('Leave empty for never expires')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!isUpdate && (
                <FormField
                  control={form.control}
                  name='count'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Quantity')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type='number'
                          min='1'
                          max='100'
                          placeholder={t('Number of codes to create')}
                          onChange={(e) =>
                            field.onChange(parseInt(e.target.value, 10) || 1)
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {t('Create multiple redemption codes at once (1-100)')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          </form>
        </Form>
        <DialogFooter className='flex-shrink-0 border-t p-4'>
          <DialogClose render={<Button variant='outline' />}>
            {t('Close')}
          </DialogClose>
          <Button form='redemption-form' type='submit' disabled={isSubmitting}>
            {isSubmitting ? t('Saving...') : t('Save changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
