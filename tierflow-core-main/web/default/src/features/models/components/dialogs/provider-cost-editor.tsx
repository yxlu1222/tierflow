/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 上游成本编辑器 —— 模型编辑对话框「上游成本」页,形态完全参考定价设置:
 *
 *  - 按 Token:输入/输出成本主框 + 可开关车道(缓存命中/缓存创建/图像/音频),
 *    与定价 per-token 同构。保存时生成单层成本表达式 tier("base", p*X + c*Y + …)
 *    写入 provider_cost_setting.cost_expr 的模型全局键 —— 表达式引擎按 usedVars
 *    自动排除已单独计价的子类别,车道未启用时对应 token 留在 p/c 里按基础成本计。
 *  - 按次:固定 ¥/次,写遗留扁平 ProviderModelCost.per_request(对齐售价 ModelPrice)。
 *  - 表达式:完整 TieredPricingEditor(分层/len 条件/header/param;成本引擎不支持
 *    ||| 请求规则,编辑器已隐藏该区)。
 *
 * 回显回退链与结算层一致:成本表达式(单层简单形态自动解析回「按 Token」车道,
 * 复杂表达式进「表达式」模式) -> 扁平 per_request -> 扁平 input/output(遗留,
 * 回显进「按 Token」,真正编辑保存时才迁移为表达式)。
 *
 * 变更判定(防误清):getData() 与打开时的基线快照比较,只在「当前 Tab 的内容
 * 相对基线确实变化」时才产出写入动作 —— 仅浏览其它 Tab 后保存不会清掉已有
 * 配置,也不会把表达式编辑器自动生成的零成本默认表达式落库。清除配置的唯一
 * 途径:在「基线所在模式」的 Tab 上清空内容后保存。
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  CACHE_MODE_GENERIC,
  generateExprFromVisualConfig,
  tryParseVisualConfig,
  type VisualTier,
} from '@/lib/tier-expr'
import { Label } from '@/components/ui/label'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  PriceInput,
  PriceLane,
} from '@/features/system-settings/models/model-pricing-sheet'
import { TieredPricingEditor } from '@/features/system-settings/models/tiered-pricing-editor'

export type ProviderCostEntry = {
  input?: number
  output?: number
  cached_input?: number
  /** 每次调用固定成本(¥);设置后按次计成本,token 字段不参与(对齐售价按次模式) */
  per_request?: number
}

export type CostMode = 'per-token' | 'per-request' | 'expr'

/**
 * getData() 的产物;由宿主(模型编辑对话框)负责落盘。
 * unchanged = 本次保存不触碰成本配置(改名迁移除外,由宿主处理)。
 */
export type ProviderCostData =
  | { kind: 'unchanged' }
  | { kind: 'clear' }
  | { kind: 'expr'; expr: string }
  | { kind: 'per-request'; value: number }

export type ProviderCostEditorHandle = {
  getData: () => ProviderCostData
}

type CostLaneKey = 'cache' | 'createCache' | 'image' | 'audioInput' | 'audioOutput'

// 车道 → VisualTier 字段。定价 per-token 的车道阵容去掉输出(成本侧输出是主框,
// 避免"忘开车道 = 输出零成本"的陷阱),其余一一对应。
const COST_LANES: Array<{
  key: CostLaneKey
  tierField: keyof VisualTier
  titleKey: string
  descriptionKey: string
  placeholder: string
}> = [
  {
    key: 'cache',
    tierField: 'cache_read_unit_cost',
    titleKey: 'Cache read cost',
    descriptionKey: 'Token cost for cache reads.',
    placeholder: '0.3',
  },
  {
    key: 'createCache',
    tierField: 'cache_create_unit_cost',
    titleKey: 'Cache write cost',
    descriptionKey: 'Token cost for creating cache entries.',
    placeholder: '3.75',
  },
  {
    key: 'image',
    tierField: 'image_unit_cost',
    titleKey: 'Image input cost',
    descriptionKey: 'Token cost for image input.',
    placeholder: '2.5',
  },
  {
    key: 'audioInput',
    tierField: 'audio_input_unit_cost',
    titleKey: 'Audio input cost',
    descriptionKey: 'Token cost for audio input.',
    placeholder: '3.81',
  },
  {
    key: 'audioOutput',
    tierField: 'audio_output_unit_cost',
    titleKey: 'Audio output cost',
    descriptionKey: 'Token cost for audio output.',
    placeholder: '15.11',
  },
]

const EMPTY_LANE_PRICES: Record<CostLaneKey, string> = {
  cache: '',
  createCache: '',
  image: '',
  audioInput: '',
  audioOutput: '',
}

const EMPTY_LANE_ENABLED: Record<CostLaneKey, boolean> = {
  cache: false,
  createCache: false,
  image: false,
  audioInput: false,
  audioOutput: false,
}

const numericDraftRegex = /^(\d+(\.\d*)?|\.\d*)?$/

const numToStr = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) ? String(n) : ''
}

/** 忽略空白差异的表达式等价比较(生成器与手写/存量串的空白风格可能不同) */
const exprEq = (a: string, b: string) =>
  a.replace(/\s+/g, '') === b.replace(/\s+/g, '')

type PerTokenState = {
  input: string
  output: string
  lanePrices: Record<CostLaneKey, string>
  laneEnabled: Record<CostLaneKey, boolean>
}

const emptyPerToken = (): PerTokenState => ({
  input: '',
  output: '',
  lanePrices: { ...EMPTY_LANE_PRICES },
  laneEnabled: { ...EMPTY_LANE_ENABLED },
})

// 表达式 → 按 Token 车道回显。仅接受"单层、无条件、且不含本 UI 没有车道的
// 变量(cc1h/img_o)"的表达式;其余进表达式模式,避免有损降级。
function tryExprToPerToken(expr: string): PerTokenState | null {
  const cfg = tryParseVisualConfig(expr)
  if (!cfg || cfg.tiers.length !== 1) return null
  const tier = cfg.tiers[0]
  if (tier.conditions && tier.conditions.length > 0) return null
  if (
    Number(tier.cache_create_1h_unit_cost) > 0 ||
    Number(tier.image_output_unit_cost) > 0
  ) {
    return null
  }
  const state = emptyPerToken()
  state.input = numToStr(tier.input_unit_cost)
  state.output = numToStr(tier.output_unit_cost)
  for (const lane of COST_LANES) {
    const v = Number(tier[lane.tierField]) || 0
    if (v > 0) {
      state.lanePrices[lane.key] = String(v)
      state.laneEnabled[lane.key] = true
    }
  }
  return state
}

// 按 Token 车道 → 单层成本表达式。全部留空 = 未配置,返回空串。
function perTokenToExpr(state: PerTokenState): string {
  const hasAny =
    state.input.trim() !== '' ||
    state.output.trim() !== '' ||
    COST_LANES.some(
      (lane) =>
        state.laneEnabled[lane.key] && state.lanePrices[lane.key].trim() !== ''
    )
  if (!hasAny) return ''

  const tier: VisualTier = {
    label: 'base',
    conditions: [],
    input_unit_cost: Number(state.input) || 0,
    output_unit_cost: Number(state.output) || 0,
    cache_mode: CACHE_MODE_GENERIC,
  }
  for (const lane of COST_LANES) {
    if (state.laneEnabled[lane.key]) {
      const v = Number(state.lanePrices[lane.key]) || 0
      if (v > 0) tier[lane.tierField] = v
    }
  }
  return generateExprFromVisualConfig({ tiers: [tier] })
}

// 遗留扁平配置 → 按 Token 车道。显式补上缓存两条车道以保持扁平路径的成本
// 语义:扁平计算里缓存命中按 cached_input(未配则按 input)、缓存写入按 input
// 计价——迁移成表达式后若省略 cr/cc,Claude 语义上游(input_tokens 不含缓存)
// 的缓存 token 会变成 0 成本,静默抬高毛利。
function legacyEntryToPerToken(entry: ProviderCostEntry): PerTokenState {
  const state = emptyPerToken()
  state.input = entry.input != null ? String(entry.input) : ''
  state.output = entry.output != null ? String(entry.output) : ''
  const inputRate = Number(entry.input) || 0
  const cachedRate =
    entry.cached_input != null && entry.cached_input > 0
      ? entry.cached_input
      : inputRate
  if (cachedRate > 0) {
    state.lanePrices.cache = String(cachedRate)
    state.laneEnabled.cache = true
  }
  if (inputRate > 0) {
    state.lanePrices.createCache = String(inputRate)
    state.laneEnabled.createCache = true
  }
  return state
}

/** 基线快照:打开对话框时存储侧的成本配置形态,用于 getData 的变更判定。 */
type CostBaseline =
  | { mode: 'none' }
  | { mode: 'per-token' | 'expr'; expr: string }
  | { mode: 'per-request'; value: number }

type ProviderCostEditorProps = {
  modelName: string
  /**
   * 快照应用的稳定标识(如 currentRow.id / 'new')。仅当它变化(换了编辑目标)
   * 或用户尚未编辑时才用 entry/expr 重置内部状态 —— 避免 system-options
   * 刷新(保存流程中会多次 invalidate)把用户未落盘的编辑重置回旧快照。
   */
  resetKey: string | number
  /** 遗留扁平配置(打开对话框时的快照) */
  entry?: ProviderCostEntry
  /** cost_expr[model](打开对话框时的快照) */
  expr?: string
}

export const ProviderCostEditor = forwardRef<
  ProviderCostEditorHandle,
  ProviderCostEditorProps
>(function ProviderCostEditor({ modelName, resetKey, entry, expr }, ref) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<CostMode>('per-token')
  const [perToken, setPerToken] = useState<PerTokenState>(emptyPerToken)
  const [perRequest, setPerRequest] = useState('')
  const [costExpr, setCostExpr] = useState('')

  const baselineRef = useRef<CostBaseline>({ mode: 'none' })
  const appliedKeyRef = useRef<string | number | null>(null)
  const dirtyRef = useRef(false)

  // 打开/切换编辑目标时按回退链回显并记录基线。用户已编辑后不再被
  // entry/expr 的引用变化(options 刷新)重置。
  useEffect(() => {
    if (appliedKeyRef.current === resetKey && dirtyRef.current) return
    appliedKeyRef.current = resetKey
    dirtyRef.current = false

    if (expr) {
      const parsed = tryExprToPerToken(expr)
      if (parsed) {
        setMode('per-token')
        setPerToken(parsed)
        baselineRef.current = { mode: 'per-token', expr }
      } else {
        setMode('expr')
        setPerToken(emptyPerToken())
        baselineRef.current = { mode: 'expr', expr }
      }
      setCostExpr(expr)
      setPerRequest('')
      return
    }
    setCostExpr('')
    if (entry?.per_request) {
      setMode('per-request')
      setPerRequest(String(entry.per_request))
      setPerToken(emptyPerToken())
      baselineRef.current = { mode: 'per-request', value: entry.per_request }
      return
    }
    setPerRequest('')
    if (entry && (entry.input != null || entry.output != null)) {
      // 遗留扁平 → 按 Token 车道(基线为其表达式等价形态;真正编辑时才迁移)
      const state = legacyEntryToPerToken(entry)
      setMode('per-token')
      setPerToken(state)
      baselineRef.current = { mode: 'per-token', expr: perTokenToExpr(state) }
      return
    }
    setMode('per-token')
    setPerToken(emptyPerToken())
    baselineRef.current = { mode: 'none' }
  }, [resetKey, entry, expr])

  useImperativeHandle(
    ref,
    () => ({
      getData: (): ProviderCostData => {
        const baseline = baselineRef.current

        if (mode === 'per-token') {
          const exprNow = perTokenToExpr(perToken)
          if (exprNow === '') {
            // 空白按 Token 页:仅当基线本来就是按 Token 形态时才视为「清除」;
            // 基线是表达式/按次时只是浏览,不得据此清配置。
            return baseline.mode === 'per-token'
              ? { kind: 'clear' }
              : { kind: 'unchanged' }
          }
          if (baseline.mode === 'per-token' && exprEq(exprNow, baseline.expr)) {
            return { kind: 'unchanged' }
          }
          return { kind: 'expr', expr: exprNow }
        }

        if (mode === 'per-request') {
          const value = Number(perRequest.trim())
          const valid = Number.isFinite(value) && value > 0
          if (!valid) {
            return baseline.mode === 'per-request'
              ? { kind: 'clear' }
              : { kind: 'unchanged' }
          }
          if (baseline.mode === 'per-request' && value === baseline.value) {
            return { kind: 'unchanged' }
          }
          return { kind: 'per-request', value }
        }

        // expr 模式
        const e = costExpr.trim()
        if (baseline.mode === 'expr' || baseline.mode === 'per-token') {
          if (e === '') return { kind: 'clear' }
          if (exprEq(e, baseline.expr)) return { kind: 'unchanged' }
          return { kind: 'expr', expr: e }
        }
        // 基线无表达式(none / per-request):空串或编辑器挂载时自动生成的
        // 零成本默认表达式都视为「未配置」,不落库(否则浏览一眼表达式页就会
        // 把 provider_cost=0 写进去,财务面板显示虚假 100% 毛利)。
        if (e === '' || exprEq(e, 'tier("base", p * 0 + c * 0)')) {
          return { kind: 'unchanged' }
        }
        return { kind: 'expr', expr: e }
      },
    }),
    [mode, perToken, perRequest, costExpr]
  )

  const markDirty = () => {
    dirtyRef.current = true
  }

  const setLanePrice = (lane: CostLaneKey, value: string) => {
    if (!numericDraftRegex.test(value)) return
    markDirty()
    setPerToken((prev) => ({
      ...prev,
      lanePrices: { ...prev.lanePrices, [lane]: value },
    }))
  }

  const setLaneEnabled = (lane: CostLaneKey, checked: boolean) => {
    markDirty()
    setPerToken((prev) => ({
      ...prev,
      laneEnabled: { ...prev.laneEnabled, [lane]: checked },
      lanePrices: checked
        ? prev.lanePrices
        : { ...prev.lanePrices, [lane]: '' },
    }))
  }

  // 保存预览:按 Token 模式展示将写入的成本表达式,让"车道 → 表达式"的
  // 落盘规则可见(与定价页 Save preview 同一用意)。
  const perTokenPreview = useMemo(
    () => (mode === 'per-token' ? perTokenToExpr(perToken) : ''),
    [mode, perToken]
  )

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => {
        markDirty()
        setMode(v as CostMode)
      }}
    >
      <TabsList className='grid w-full grid-cols-3'>
        <TabsTrigger value='per-token'>{t('Per-token')}</TabsTrigger>
        <TabsTrigger value='per-request'>{t('Per-request')}</TabsTrigger>
        <TabsTrigger value='expr'>{t('Expression')}</TabsTrigger>
      </TabsList>

      <TabsContent value='per-token' className='mt-0 flex flex-col gap-5'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cost-input'>{t('Input cost')}</Label>
            <PriceInput
              id='cost-input'
              value={perToken.input}
              placeholder='2'
              onChange={(value) => {
                if (!numericDraftRegex.test(value)) return
                markDirty()
                setPerToken((prev) => ({ ...prev, input: value }))
              }}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Cost in CNY per 1M input tokens.')}
            </p>
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='cost-output'>{t('Output cost')}</Label>
            <PriceInput
              id='cost-output'
              value={perToken.output}
              placeholder='8'
              onChange={(value) => {
                if (!numericDraftRegex.test(value)) return
                markDirty()
                setPerToken((prev) => ({ ...prev, output: value }))
              }}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Cost in CNY per 1M output tokens.')}
            </p>
          </div>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          {COST_LANES.map((lane) => (
            <PriceLane
              key={lane.key}
              title={t(lane.titleKey)}
              description={t(lane.descriptionKey)}
              placeholder={lane.placeholder}
              value={perToken.lanePrices[lane.key]}
              enabled={perToken.laneEnabled[lane.key]}
              enabledHint={t('Cost in CNY per 1M tokens.')}
              onEnabledChange={(checked) => setLaneEnabled(lane.key, checked)}
              onChange={(value) => setLanePrice(lane.key, value)}
            />
          ))}
        </div>

        {perTokenPreview && (
          <p className='text-muted-foreground text-xs break-all'>
            {t('Saved as cost expression:')} {perTokenPreview}
          </p>
        )}
      </TabsContent>

      <TabsContent value='per-request' className='mt-0'>
        <div className='flex max-w-sm flex-col gap-2'>
          <Label htmlFor='cost-per-request'>{t('Fixed cost')}</Label>
          <InputGroup>
            <InputGroupAddon>¥</InputGroupAddon>
            <InputGroupInput
              id='cost-per-request'
              inputMode='decimal'
              placeholder='0.01'
              value={perRequest}
              onChange={(e) => {
                if (numericDraftRegex.test(e.target.value)) {
                  markDirty()
                  setPerRequest(e.target.value)
                }
              }}
            />
            <InputGroupAddon align='inline-end'>
              {t('per request')}
            </InputGroupAddon>
          </InputGroup>
          <p className='text-muted-foreground text-xs'>
            {t('Upstream cost in CNY per request, regardless of tokens used.')}
          </p>
        </div>
      </TabsContent>

      <TabsContent value='expr' className='mt-0'>
        <div className='flex flex-col gap-3'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Cost expressions use the same engine and variables as pricing expressions; coefficients are upstream cost in CNY per 1M tokens. Request rules (|||) are not supported for cost.'
            )}
          </p>
          <TieredPricingEditor
            modelName={modelName}
            billingExpr={costExpr}
            requestRuleExpr=''
            onBillingExprChange={(next) => {
              // 编辑器挂载/同步也会触发本回调(非用户操作):仅当值真正偏离
              // 基线才标脏——基线表达式的空白规范化回写不算编辑,而挂载
              // 自动生成的零成本默认串只会发生在用户点开本 Tab 之后(切 Tab
              // 已标脏),不会误伤快照晚到的初始应用。
              const b = baselineRef.current
              const baseExpr =
                b.mode === 'expr' || b.mode === 'per-token' ? b.expr : ''
              if (!exprEq(next, baseExpr)) {
                dirtyRef.current = true
              }
              setCostExpr(next)
            }}
            onRequestRuleExprChange={() => {}}
            hideRequestRules
          />
        </div>
      </TabsContent>
    </Tabs>
  )
})
