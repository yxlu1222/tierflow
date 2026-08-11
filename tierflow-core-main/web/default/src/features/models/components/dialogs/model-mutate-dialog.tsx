/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as z from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { Textarea } from '@/components/ui/textarea'
import { JsonEditor } from '@/components/json-editor'
import { TagInput } from '@/components/tag-input'
import {
  combineBillingExpr,
  splitBillingExprAndRequestRules,
} from '@/lib/billing-expr'
import {
  useSystemOptions,
  getOptionValue,
} from '@/features/system-settings/hooks/use-system-options'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import {
  ModelPricingEditorPanel,
  type ModelPricingEditorHandle,
  type ModelRatioData,
} from '@/features/system-settings/models/model-pricing-sheet'
import { normalizeJsonString } from '@/features/system-settings/models/utils'
import type { ModelSettings } from '@/features/system-settings/types'
import { safeJsonParse } from '@/features/system-settings/utils/json-parser'
import { createModel, updateModel, getModel, getVendors } from '../../api'
import {
  ProviderCostEditor,
  type ProviderCostData,
  type ProviderCostEditorHandle,
  type ProviderCostEntry,
} from './provider-cost-editor'
import { getNameRuleOptions, ENDPOINT_TEMPLATES } from '../../constants'
import { modelsQueryKeys, vendorsQueryKeys, parseModelTags } from '../../lib'
import type { Model } from '../../types'

const modelFormSchema = z.object({
  id: z.number().optional(),
  model_name: z.string().min(1, 'Model name is required'),
  description: z.string(),
  icon: z.string(),
  tags: z.array(z.string()),
  vendor_id: z.number().optional(),
  endpoints: z.string(),
  name_rule: z.number(),
  status: z.boolean(),
})

type ModelFormValues = z.infer<typeof modelFormSchema>

type MutateTab = 'basic' | 'pricing' | 'cost'


type ModelMutateDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow?: Model | null
}

const parseNumberMap = (raw: string | undefined) =>
  safeJsonParse<Record<string, number>>(raw ?? '', {
    fallback: {},
    silent: true,
  })

const parseStringMap = (raw: string | undefined) =>
  safeJsonParse<Record<string, string>>(raw ?? '', {
    fallback: {},
    silent: true,
  })

export function ModelMutateDialog({
  open,
  onOpenChange,
  currentRow,
}: ModelMutateDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isEditing = Boolean(currentRow?.id)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeTab, setActiveTab] = useState<MutateTab>('basic')
  const [oldModelName, setOldModelName] = useState('')
  const pricingRef = useRef<ModelPricingEditorHandle>(null)

  // Upstream cost (what you pay providers) — used only for margin reporting,
  // never billing. The editor mirrors the pricing tab's three modes; per-token
  // and expression persist to `provider_cost_setting.cost_expr` (model-global
  // key), per-request to the flat `ProviderModelCost.per_request`.
  const costRef = useRef<ProviderCostEditorHandle>(null)

  // Fetch vendors for dropdown
  const { data: vendorsData } = useQuery({
    queryKey: vendorsQueryKeys.list(),
    queryFn: () => getVendors({ page_size: 1000 }),
    enabled: open,
  })
  const vendors = vendorsData?.data?.items || []

  // Fetch model detail if editing
  const { data: modelData } = useQuery({
    queryKey: modelsQueryKeys.detail(currentRow?.id || 0),
    queryFn: () => getModel(currentRow!.id),
    enabled: open && isEditing,
  })

  // Fetch system options for pricing configuration
  const { data: systemOptionsData } = useSystemOptions()
  const updateOption = useUpdateOption()

  // Extract the pricing-relevant slice of system options.
  const modelSettings = useMemo(() => {
    if (!systemOptionsData?.data) return null
    const defaults: Partial<ModelSettings> = {
      ModelPrice: '',
      ModelRatio: '',
      CacheRatio: '',
      CreateCacheRatio: '',
      CompletionRatio: '',
      ImageRatio: '',
      AudioRatio: '',
      AudioCompletionRatio: '',
      'billing_setting.billing_mode': '{}',
      'billing_setting.billing_expr': '{}',
      ProviderModelCost: '',
      'provider_cost_setting.cost_expr': '{}',
    }
    return getOptionValue(
      systemOptionsData.data,
      defaults as ModelSettings
    ) as ModelSettings
  }, [systemOptionsData])

  const form = useForm<ModelFormValues>({
    resolver: zodResolver(modelFormSchema),
    defaultValues: {
      model_name: '',
      description: '',
      icon: '',
      tags: [],
      vendor_id: undefined,
      endpoints: '',
      name_rule: 0,
      status: true,
    },
  })

  const watchedModelName = form.watch('model_name')

  // Build the pricing editData for the model being edited from the global
  // option maps (pricing is keyed by model name, not stored on the model row).
  const pricingEditData = useMemo<ModelRatioData | null>(() => {
    if (!isEditing || !modelSettings) return null
    const name = currentRow?.model_name
    if (!name) return null

    const priceMap = parseNumberMap(modelSettings.ModelPrice)
    const ratioMap = parseNumberMap(modelSettings.ModelRatio)
    const cacheMap = parseNumberMap(modelSettings.CacheRatio)
    const createCacheMap = parseNumberMap(modelSettings.CreateCacheRatio)
    const completionMap = parseNumberMap(modelSettings.CompletionRatio)
    const imageMap = parseNumberMap(modelSettings.ImageRatio)
    const audioMap = parseNumberMap(modelSettings.AudioRatio)
    const audioCompletionMap = parseNumberMap(
      modelSettings.AudioCompletionRatio
    )
    const billingModeMap = parseStringMap(
      modelSettings['billing_setting.billing_mode']
    )
    const billingExprMap = parseStringMap(
      modelSettings['billing_setting.billing_expr']
    )

    const base: ModelRatioData = {
      name,
      price: priceMap[name]?.toString() || '',
      ratio: ratioMap[name]?.toString() || '',
      cacheRatio: cacheMap[name]?.toString() || '',
      createCacheRatio: createCacheMap[name]?.toString() || '',
      completionRatio: completionMap[name]?.toString() || '',
      imageRatio: imageMap[name]?.toString() || '',
      audioRatio: audioMap[name]?.toString() || '',
      audioCompletionRatio: audioCompletionMap[name]?.toString() || '',
    }

    if (billingModeMap[name] === 'tiered_expr') {
      const { billingExpr, requestRuleExpr } = splitBillingExprAndRequestRules(
        billingExprMap[name] || ''
      )
      return {
        ...base,
        billingMode: 'tiered_expr',
        billingExpr,
        requestRuleExpr,
      }
    }

    return {
      ...base,
      billingMode: base.price !== '' ? 'per-request' : 'per-token',
    }
  }, [isEditing, modelSettings, currentRow])

  // Parse the global upstream-cost map ({ modelName: {input, output, cached_input} }).
  const costMap = useMemo<Record<string, ProviderCostEntry>>(() => {
    if (!modelSettings) return {}
    return safeJsonParse<Record<string, ProviderCostEntry>>(
      modelSettings.ProviderModelCost ?? '',
      { fallback: {}, silent: true }
    )
  }, [modelSettings])

  // Parse the cost-expression map. Keys: "<model>" (global) or "<chId>|<model>"
  // (channel override, no UI here — preserved verbatim on save).
  const costExprMap = useMemo<Record<string, string>>(() => {
    if (!modelSettings) return {}
    return parseStringMap(modelSettings['provider_cost_setting.cost_expr'])
  }, [modelSettings])

  // Reset the metadata form whenever the dialog opens / target changes.
  useEffect(() => {
    if (!open) return
    setActiveTab('basic')

    if (isEditing && modelData?.data) {
      const model = modelData.data
      setOldModelName(model.model_name)
      form.reset({
        id: model.id,
        model_name: model.model_name,
        description: model.description || '',
        icon: model.icon || '',
        tags: parseModelTags(model.tags),
        vendor_id: model.vendor_id,
        endpoints: model.endpoints || '',
        name_rule: model.name_rule || 0,
        status: model.status === 1,
      })
    } else if (!isEditing) {
      setOldModelName('')
      form.reset({
        model_name: currentRow?.model_name || '',
        description: '',
        icon: '',
        tags: [],
        vendor_id: undefined,
        endpoints: '',
        name_rule: 0,
        status: true,
      })
    }
  }, [open, isEditing, modelData, currentRow, form])

  // Snapshot for the cost editor: the flat entry and cost expression of the
  // model being edited. The editor resolves the display mode itself, mirroring
  // the settlement fallback chain (expression -> per_request -> flat tokens).
  const costEditorEntry = useMemo(
    () =>
      currentRow?.model_name ? costMap[currentRow.model_name] : undefined,
    [costMap, currentRow]
  )
  const costEditorExpr = useMemo(
    () =>
      currentRow?.model_name ? costExprMap[currentRow.model_name] : undefined,
    [costExprMap, currentRow]
  )

  const handleFillEndpointTemplate = (templateKey: string) => {
    const template = ENDPOINT_TEMPLATES[templateKey]
    if (template) {
      const templateJson = JSON.stringify({ [templateKey]: template }, null, 2)
      form.setValue('endpoints', templateJson)
    }
  }

  // Merge the pricing data for `finalName` back into the global option maps,
  // clearing stale entries (including the previous name on rename), then push
  // only the option keys that actually changed.
  const persistPricing = useCallback(
    async (data: ModelRatioData, finalName: string) => {
      if (!modelSettings) return

      const priceMap = parseNumberMap(modelSettings.ModelPrice)
      const ratioMap = parseNumberMap(modelSettings.ModelRatio)
      const cacheMap = parseNumberMap(modelSettings.CacheRatio)
      const createCacheMap = parseNumberMap(modelSettings.CreateCacheRatio)
      const completionMap = parseNumberMap(modelSettings.CompletionRatio)
      const imageMap = parseNumberMap(modelSettings.ImageRatio)
      const audioMap = parseNumberMap(modelSettings.AudioRatio)
      const audioCompletionMap = parseNumberMap(
        modelSettings.AudioCompletionRatio
      )
      const billingModeMap = parseStringMap(
        modelSettings['billing_setting.billing_mode']
      )
      const billingExprMap = parseStringMap(
        modelSettings['billing_setting.billing_expr']
      )

      const setIfPresent = (
        target: Record<string, number>,
        name: string,
        value: string | undefined
      ) => {
        if (!value || value === '') return
        const parsed = parseFloat(value)
        if (Number.isFinite(parsed)) target[name] = parsed
      }

      // Names to clear: the target name plus the old name on rename.
      const staleNames = new Set<string>([finalName])
      if (oldModelName && oldModelName !== finalName) {
        staleNames.add(oldModelName)
      }
      for (const name of staleNames) {
        delete priceMap[name]
        delete ratioMap[name]
        delete cacheMap[name]
        delete createCacheMap[name]
        delete completionMap[name]
        delete imageMap[name]
        delete audioMap[name]
        delete audioCompletionMap[name]
        delete billingModeMap[name]
        delete billingExprMap[name]
      }

      if (data.billingMode === 'tiered_expr') {
        const combined = combineBillingExpr(
          data.billingExpr || '',
          data.requestRuleExpr || ''
        )
        if (combined) {
          billingModeMap[finalName] = 'tiered_expr'
          billingExprMap[finalName] = combined
        }
        // Keep ratio/price values as fallback while billing_setting propagates
        // across instances (backend checks billing_mode first).
        setIfPresent(priceMap, finalName, data.price)
        setIfPresent(ratioMap, finalName, data.ratio)
        setIfPresent(cacheMap, finalName, data.cacheRatio)
        setIfPresent(createCacheMap, finalName, data.createCacheRatio)
        setIfPresent(completionMap, finalName, data.completionRatio)
        setIfPresent(imageMap, finalName, data.imageRatio)
        setIfPresent(audioMap, finalName, data.audioRatio)
        setIfPresent(audioCompletionMap, finalName, data.audioCompletionRatio)
      } else if (data.price && data.price !== '') {
        setIfPresent(priceMap, finalName, data.price)
      } else {
        setIfPresent(ratioMap, finalName, data.ratio)
        setIfPresent(cacheMap, finalName, data.cacheRatio)
        setIfPresent(createCacheMap, finalName, data.createCacheRatio)
        setIfPresent(completionMap, finalName, data.completionRatio)
        setIfPresent(imageMap, finalName, data.imageRatio)
        setIfPresent(audioMap, finalName, data.audioRatio)
        setIfPresent(audioCompletionMap, finalName, data.audioCompletionRatio)
      }

      const updates: Array<{ key: string; value: string }> = []
      const pushIfChanged = (
        key: string,
        map: Record<string, unknown>,
        original: string | undefined
      ) => {
        const next = normalizeJsonString(JSON.stringify(map))
        if (next !== normalizeJsonString(original ?? '')) {
          updates.push({ key, value: next })
        }
      }

      pushIfChanged('ModelPrice', priceMap, modelSettings.ModelPrice)
      pushIfChanged('ModelRatio', ratioMap, modelSettings.ModelRatio)
      pushIfChanged('CacheRatio', cacheMap, modelSettings.CacheRatio)
      pushIfChanged(
        'CreateCacheRatio',
        createCacheMap,
        modelSettings.CreateCacheRatio
      )
      pushIfChanged(
        'CompletionRatio',
        completionMap,
        modelSettings.CompletionRatio
      )
      pushIfChanged('ImageRatio', imageMap, modelSettings.ImageRatio)
      pushIfChanged('AudioRatio', audioMap, modelSettings.AudioRatio)
      pushIfChanged(
        'AudioCompletionRatio',
        audioCompletionMap,
        modelSettings.AudioCompletionRatio
      )
      pushIfChanged(
        'billing_setting.billing_mode',
        billingModeMap,
        modelSettings['billing_setting.billing_mode']
      )
      pushIfChanged(
        'billing_setting.billing_expr',
        billingExprMap,
        modelSettings['billing_setting.billing_expr']
      )

      for (const update of updates) {
        await updateOption.mutateAsync(update)
      }
    },
    [modelSettings, oldModelName, updateOption]
  )

  // Merge upstream cost for `finalName` into the cost stores, clearing stale
  // entries (incl. the old name on rename). Modes are mutually exclusive on
  // save — the two non-active stores are cleared so the settlement fallback
  // chain (expression -> flat -> cost=price) resolves to the chosen mode.
  // Blank fields in the active mode remove the model entirely (cost=price).
  // 成本落盘。要点:
  //  - data 由 handleSave 在任何 await 之前从编辑器捕获,避免 options 刷新
  //    竞态把未落盘的编辑重置后才被读取;
  //  - kind='unchanged' 时不触碰成本配置(改名时仍迁移键名,值原样保留);
  //  - 「先写入、后清除」+ 校验每次写入的 success:成本表达式保存会经后端
  //    SmokeTest 校验,若先清旧配置再写新表达式,写入被拒时旧配置已丢——
  //    因此含新增内容的那个 option 先写,失败即抛错中止,旧配置不动。
  const persistCost = useCallback(
    async (finalName: string, data: ProviderCostData | undefined) => {
      if (!modelSettings) return
      const renamed = Boolean(oldModelName && oldModelName !== finalName)
      if ((!data || data.kind === 'unchanged') && !renamed) return

      const map: Record<string, ProviderCostEntry> = { ...costMap }
      const exprMap: Record<string, string> = { ...costExprMap }

      // 改名迁移:模型全局键与渠道级表达式键("<chId>|<旧名>")随名走,
      // 值原样保留,否则改名会静默丢配置。
      if (renamed) {
        if (map[oldModelName] !== undefined) {
          map[finalName] = map[oldModelName]
          delete map[oldModelName]
        }
        if (exprMap[oldModelName] !== undefined) {
          exprMap[finalName] = exprMap[oldModelName]
          delete exprMap[oldModelName]
        }
        const suffix = `|${oldModelName}`
        for (const key of Object.keys(exprMap)) {
          if (!key.endsWith(suffix)) continue
          const channelPart = key.slice(0, key.length - suffix.length)
          if (/^\d+$/.test(channelPart)) {
            exprMap[`${channelPart}|${finalName}`] = exprMap[key]
            delete exprMap[key]
          }
        }
      }

      switch (data?.kind) {
        case 'expr':
          // per-token 与表达式模式统一落成本表达式(按 Token 车道在编辑器内
          // 生成单层表达式);遗留扁平 token 配置在真正编辑时迁移。
          exprMap[finalName] = data.expr
          delete map[finalName]
          break
        case 'per-request':
          map[finalName] = { input: 0, output: 0, per_request: data.value }
          delete exprMap[finalName]
          break
        case 'clear':
          delete map[finalName]
          delete exprMap[finalName]
          break
        default:
          break // unchanged(改名迁移已在上方完成)
      }

      const writeOption = async (key: string, value: string) => {
        const res = await updateOption.mutateAsync({ key, value })
        if (!res.success) {
          throw new Error(res.message || t('Failed to update setting'))
        }
      }
      const flatValue = Object.keys(map).length ? JSON.stringify(map) : ''
      const flatChanged =
        normalizeJsonString(flatValue) !==
        normalizeJsonString(modelSettings.ProviderModelCost ?? '')
      const exprValue = JSON.stringify(exprMap)
      const exprChanged =
        normalizeJsonString(exprValue) !==
        normalizeJsonString(
          modelSettings['provider_cost_setting.cost_expr'] || '{}'
        )

      // 新增内容所在的 option 先写(先写后清)。
      const writes: Array<() => Promise<void>> = []
      const pushFlat = () => {
        if (flatChanged) {
          writes.push(() => writeOption('ProviderModelCost', flatValue))
        }
      }
      const pushExpr = () => {
        if (exprChanged) {
          writes.push(() =>
            writeOption('provider_cost_setting.cost_expr', exprValue)
          )
        }
      }
      if (data?.kind === 'per-request') {
        pushFlat()
        pushExpr()
      } else {
        pushExpr()
        pushFlat()
      }
      for (const write of writes) {
        await write()
      }
    },
    [modelSettings, costMap, costExprMap, oldModelName, updateOption, t]
  )

  const handleSave = useCallback(async () => {
    // 在任何 await 之前捕获成本编辑器状态:后续 persistPricing 的多次
    // updateOption 会 invalidate system-options,刷新落地可能重置编辑器,
    // 晚读会拿到被重置的旧快照。
    const costData = costRef.current?.getData()

    // Validate metadata first; jump back to the basic tab on failure.
    const metadataValid = await form.trigger()
    if (!metadataValid) {
      setActiveTab('basic')
      return
    }

    // Validate + collect pricing; jump to the pricing tab on failure.
    const pricingData = await pricingRef.current?.submit()
    if (pricingData === null) {
      setActiveTab('pricing')
      return
    }

    const values = form.getValues()
    setIsSubmitting(true)
    try {
      const modelPayload: Partial<Model> & { id?: number } = {
        model_name: values.model_name,
        description: values.description,
        icon: values.icon,
        tags: Array.isArray(values.tags) ? values.tags.join(',') : '',
        vendor_id: values.vendor_id,
        endpoints: values.endpoints,
        name_rule: values.name_rule,
        status: values.status ? 1 : 0,
      }

      const response = isEditing
        ? await updateModel({ ...modelPayload, id: currentRow!.id })
        : await createModel(modelPayload)

      if (!response.success) {
        toast.error(response.message || t('Operation failed'))
        return
      }

      if (pricingData) {
        await persistPricing(pricingData, values.model_name)
      }
      await persistCost(values.model_name, costData)

      toast.success(
        isEditing
          ? t('Model updated successfully')
          : t('Model created successfully')
      )
      queryClient.invalidateQueries({ queryKey: modelsQueryKeys.lists() })
      queryClient.invalidateQueries({ queryKey: ['system-options'] })
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error((error as Error)?.message || t('Operation failed'))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    form,
    isEditing,
    currentRow,
    persistPricing,
    persistCost,
    queryClient,
    onOpenChange,
    t,
  ])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Prevent closing mid-save (e.g. clicking outside) to avoid partial writes.
        if (isSubmitting && !next) return
        onOpenChange(next)
      }}
    >
      <DialogContent className='flex max-h-[90vh] flex-col gap-4 sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('Edit Model') : t('Create Model')}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("Update model configuration and click save when you're done.")
              : t(
                  'Add a new model to the system by providing the necessary information.'
                )}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as MutateTab)}
          className='min-h-0 flex-1'
        >
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='basic'>{t('Model information')}</TabsTrigger>
            <TabsTrigger value='pricing'>{t('Pricing settings')}</TabsTrigger>
            <TabsTrigger value='cost'>{t('Upstream cost')}</TabsTrigger>
          </TabsList>

          <div className='min-h-0 flex-1 overflow-y-auto'>
            {/* Basic information */}
            <TabsContent value='basic' keepMounted className='mt-0'>
              <Form {...form}>
                <form
                  id='model-form'
                  onSubmit={form.handleSubmit(() => handleSave())}
                  className='flex flex-col gap-5 py-1'
                >
                  <FormField
                    control={form.control}
                    name='model_name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Model Name *')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('gpt-4, claude-3-opus, etc.')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('The unique identifier for this model')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='description'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Description')}</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder={t('Describe this model...')}
                            rows={3}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='icon'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Icon')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('OpenAI, Anthropic, etc.')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription className='text-xs'>
                          {t('@lobehub/icons key')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='vendor_id'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Vendor')}</FormLabel>
                        <Select
                          items={vendors.map((vendor) => ({
                            value: String(vendor.id),
                            label: vendor.name,
                          }))}
                          onValueChange={(value) =>
                            field.onChange(value ? parseInt(value) : undefined)
                          }
                          value={field.value ? String(field.value) : undefined}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('Select vendor')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              {vendors.map((vendor) => (
                                <SelectItem
                                  key={vendor.id}
                                  value={String(vendor.id)}
                                >
                                  {vendor.name}
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
                    name='tags'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Tags')}</FormLabel>
                        <FormControl>
                          <TagInput
                            value={field.value || []}
                            onChange={field.onChange}
                            placeholder={t('Add tags...')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Press Enter or comma to add tags')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='name_rule'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Name Rule')}</FormLabel>
                        <FormControl>
                          <RadioGroup
                            onValueChange={(value) =>
                              field.onChange(parseInt(value))
                            }
                            value={String(field.value)}
                            className='grid grid-cols-2 gap-4'
                          >
                            {getNameRuleOptions(t).map((option) => (
                              <div
                                key={option.value}
                                className='flex items-center space-x-2'
                              >
                                <RadioGroupItem
                                  value={String(option.value)}
                                  id={`rule-${option.value}`}
                                />
                                <Label
                                  htmlFor={`rule-${option.value}`}
                                  className='cursor-pointer font-normal'
                                >
                                  {option.label}
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </FormControl>
                        <FormDescription>
                          {t('How this model name should match requests')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='endpoints'
                    render={({ field }) => (
                      <FormItem>
                        <div className='flex items-center justify-between'>
                          <FormLabel>{t('Endpoint Configuration')}</FormLabel>
                          <Select<string>
                            items={Object.keys(ENDPOINT_TEMPLATES).map(
                              (key) => ({ value: key, label: key })
                            )}
                            onValueChange={(v) =>
                              v !== null && handleFillEndpointTemplate(v)
                            }
                          >
                            <SelectTrigger size='sm' className='w-[200px]'>
                              <SelectValue placeholder={t('Load template...')} />
                            </SelectTrigger>
                            <SelectContent alignItemWithTrigger={false}>
                              <SelectGroup>
                                {Object.keys(ENDPOINT_TEMPLATES).map((key) => (
                                  <SelectItem key={key} value={key}>
                                    {key}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </div>
                        <FormControl>
                          <JsonEditor
                            value={field.value || ''}
                            onChange={field.onChange}
                            keyPlaceholder='endpoint_type'
                            valuePlaceholder='{"path": "/v1/...", "method": "POST"}'
                            keyLabel={t('Endpoint Type')}
                            valueLabel={t('Configuration')}
                            valueType='any'
                            emptyMessage={t(
                              'No endpoints configured. Switch to JSON mode or add rows to define endpoints.'
                            )}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'Define API endpoints for this model (JSON format)'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='status'
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between rounded-lg border p-3'>
                        <div className='flex flex-col gap-0.5'>
                          <FormLabel className='text-base'>
                            {t('Enabled')}
                          </FormLabel>
                          <FormDescription>
                            {t('Enable or disable this model')}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
            </TabsContent>

            {/* Pricing */}
            <TabsContent value='pricing' keepMounted className='mt-0'>
              <p className='text-muted-foreground mb-3 text-xs'>
                {t(
                  'Model-global default price (fallback when a channel has no per-channel override). Per-channel selling overrides live on the Model Groups page.'
                )}
              </p>
              <ModelPricingEditorPanel
                ref={pricingRef}
                embedded
                nameOverride={watchedModelName}
                editData={pricingEditData}
                onSave={() => {}}
              />
            </TabsContent>

            {/* Upstream cost (margin reporting only) — three modes mirroring
                the pricing tab: per-token / per-request / expression */}
            <TabsContent value='cost' keepMounted className='mt-0'>
              <div className='flex flex-col gap-5 py-1'>
                <Alert variant='default'>
                  <AlertTitle>
                    {t('Upstream cost for margin reporting')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'Per-model upstream cost (what you pay providers), in CNY (¥) — the same unit as pricing. Used to compute the revenue / cost / margin on the Route Monitor page. Does not affect what users are charged. Models not listed default to cost = price (0 margin).'
                    )}
                  </AlertDescription>
                </Alert>

                <ProviderCostEditor
                  ref={costRef}
                  modelName={watchedModelName}
                  resetKey={currentRow?.id ?? 'new'}
                  entry={costEditorEntry}
                  expr={costEditorExpr}
                />

                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Leave all fields blank to remove this model from the cost table.'
                  )}{' '}
                  {t(
                    'This is the model-global default cost; a channel-scoped cost expression ("channelId|model") takes precedence when configured.'
                  )}
                </p>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter>
          <DialogClose
            render={<Button variant='outline' disabled={isSubmitting} />}
          >
            {t('Cancel')}
          </DialogClose>
          <Button type='button' onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {isEditing ? t('Update Model') : t('Save changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
