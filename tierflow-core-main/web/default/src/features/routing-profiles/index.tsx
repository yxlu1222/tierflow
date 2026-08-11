/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from '@tanstack/react-table'
import { Plus, Pencil, Trash2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { DataTablePagination } from '@/components/data-table'
import { SectionPageLayout } from '@/components/layout'
import { SingleSelect } from '@/components/single-select'
import { StatusBadge } from '@/components/status-badge'
import { getGroups as getUserGroups } from '@/features/users/api'
import {
  createRoutingProfile,
  deleteRoutingProfile,
  getModelGroups,
  getRoutingProfiles,
  updateRoutingProfile,
} from './api'
import type {
  ModelGroup,
  RoutingProfile,
  RoutingProfileFormValues,
} from './types'

// ---------- 难度档位（tier 1=最高难度…tier 5=最省） ----------

type TierRow = { start: string; end: string; model: string }

// 每档一行，携带该档在分数轴(0-10)上的起止区间与目标模型组。
const TIER_META = [
  { tier: 1, noteKey: 'Hardest' },
  { tier: 2, noteKey: '' },
  { tier: 3, noteKey: 'Fallback' },
  { tier: 4, noteKey: '' },
  { tier: 5, noteKey: 'Cheapest' },
] as const

const DEFAULT_TIER_ROWS: TierRow[] = [
  { start: '9', end: '10', model: '' }, // tier1 最高难度
  { start: '7', end: '9', model: '' }, // tier2
  { start: '5', end: '7', model: '' }, // tier3 兜底
  { start: '3', end: '5', model: '' }, // tier4
  { start: '0', end: '3', model: '' }, // tier5 最省
]

// 把后端的 score_bands 字符串 + tier_N_model 反解析成 5 行 TierRow（供编辑回填）。
function toTierRows(p: RoutingProfileFormValues): TierRow[] {
  const bandByTier = new Map<number, { lo: string; hi: string }>()
  for (const part of (p.score_bands || '').split(',')) {
    const seg = part.trim()
    if (!seg) continue
    const colon = seg.lastIndexOf(':')
    if (colon < 0) continue
    const tier = Number(seg.slice(colon + 1).trim())
    if (!Number.isFinite(tier)) continue
    const range = seg.slice(0, colon).trim()
    const dash = range.indexOf('-')
    if (dash <= 0) continue
    bandByTier.set(tier, {
      lo: range.slice(0, dash).trim(),
      hi: range.slice(dash + 1).trim(),
    })
  }
  const models = [
    p.tier_1_model,
    p.tier_2_model,
    p.tier_3_model,
    p.tier_4_model,
    p.tier_5_model,
  ]
  return DEFAULT_TIER_ROWS.map((def, i) => {
    const band = bandByTier.get(i + 1)
    return {
      start: band ? band.lo : def.start,
      end: band ? band.hi : def.end,
      model: models[i] || '',
    }
  })
}

// 把 5 行 TierRow 序列化回后端字段。score_bands 按起点升序排列，保证「最高区间在末位」——
// 后端 ResolveModel 只对最后一档做上界闭区间处理（让分数 10 能命中最高档）。
function fromTierRows(
  rows: TierRow[]
): Pick<
  RoutingProfileFormValues,
  | 'score_bands'
  | 'tier_1_model'
  | 'tier_2_model'
  | 'tier_3_model'
  | 'tier_4_model'
  | 'tier_5_model'
> {
  const score_bands = rows
    .map((r, i) => ({
      tier: i + 1,
      start: r.start.trim(),
      end: r.end.trim(),
    }))
    .filter((b) => b.start !== '' && b.end !== '')
    .sort((a, b) => Number(a.start) - Number(b.start))
    .map((b) => `${b.start}-${b.end}:${b.tier}`)
    .join(',')
  return {
    score_bands,
    tier_1_model: rows[0]?.model ?? '',
    tier_2_model: rows[1]?.model ?? '',
    tier_3_model: rows[2]?.model ?? '',
    tier_4_model: rows[3]?.model ?? '',
    tier_5_model: rows[4]?.model ?? '',
  }
}

// 本地分页只借用 react-table 的分页行模型,单元格仍手写渲染,故列定义为空。
const EMPTY_COLUMNS: ColumnDef<RoutingProfile>[] = []

// keywords 以分号分隔（如 "编程;长上下文;Agent"），列表里拆成小徽章展示。
function parseKeywords(keywords: string): string[] {
  return (keywords || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

const EMPTY_FORM: RoutingProfileFormValues = {
  slug: '',
  aliases: 'auto',
  score_bands: '0-3:5,3-5:4,5-7:3,7-9:2,9-10:1',
  tier_1_model: '',
  tier_2_model: '',
  tier_3_model: '',
  tier_4_model: '',
  tier_5_model: '',
  multimodal_model: '',
  group: '',
  enabled: true,
  description: '',
  keywords: '',
}

function toFormValues(p: RoutingProfile): RoutingProfileFormValues {
  return {
    slug: p.slug,
    aliases: p.aliases,
    score_bands: p.score_bands,
    tier_1_model: p.tier_1_model,
    tier_2_model: p.tier_2_model,
    tier_3_model: p.tier_3_model,
    tier_4_model: p.tier_4_model,
    tier_5_model: p.tier_5_model,
    multimodal_model: p.multimodal_model,
    group: p.group,
    enabled: p.enabled,
    description: p.description,
    keywords: p.keywords,
  }
}

export function RoutingProfiles() {
  const { t } = useTranslation()
  const [profiles, setProfiles] = useState<RoutingProfile[]>([])
  const [loading, setLoading] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<RoutingProfileFormValues>(EMPTY_FORM)
  const [tierRows, setTierRows] = useState<TierRow[]>(DEFAULT_TIER_ROWS)
  const [submitting, setSubmitting] = useState(false)

  const [deleting, setDeleting] = useState<RoutingProfile | null>(null)
  const [groups, setGroups] = useState<ModelGroup[]>([])
  const [userGroups, setUserGroups] = useState<string[]>([])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getRoutingProfiles()
      if (res.success) setProfiles(res.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    getModelGroups()
      .then((res) => {
        if (res.success) setGroups(res.data || [])
      })
      .catch(() => {})
    getUserGroups()
      .then((res) => {
        if (res.success) setUserGroups(res.data || [])
      })
      .catch(() => {})
  }, [load])

  // tier / 多模态下拉选项 = 模型分组（value="mg:<id>"），只列模型分组、不掺模型。
  // 老配置里 tier 存的是原始模型名（或已删除分组的 mg:<id>）——这类历史值不进候选列表，
  // 但 SingleSelect 仍会把它当前值原样显示（见下方 isKnownGroup 提示），保存时也不丢。
  const modelOptions = useMemo(
    () => groups.map((g) => ({ label: g.name, value: `mg:${g.id}` })),
    [groups]
  )

  // 判断某个 tier/多模态值是否是当前有效的模型分组（在候选列表中）。
  // 非有效值（历史原始模型名 / 已删除分组）用于提示用户重新选择模型分组。
  const isKnownGroup = useCallback(
    (v: string) => {
      const value = v?.trim()
      return !value || modelOptions.some((o) => o.value === value)
    },
    [modelOptions]
  )

  // 「限定分组」下拉：候选为用户分组（字符串名）。兼容保留当前已填但列表未覆盖的旧值。
  const groupOptions = useMemo(() => {
    const opts = userGroups.map((g) => ({ label: g, value: g }))
    const cur = form.group?.trim()
    if (cur && !userGroups.includes(cur)) {
      opts.unshift({ label: cur, value: cur })
    }
    return opts
  }, [userGroups, form.group])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setTierRows(DEFAULT_TIER_ROWS)
    setEditorOpen(true)
  }

  const openEdit = (p: RoutingProfile) => {
    setEditingId(p.id)
    const values = toFormValues(p)
    setForm(values)
    setTierRows(toTierRows(values))
    setEditorOpen(true)
  }

  const setField = <K extends keyof RoutingProfileFormValues>(
    key: K,
    value: RoutingProfileFormValues[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  const setTierField = (index: number, key: keyof TierRow, value: string) =>
    setTierRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row))
    )

  const onSubmit = async () => {
    if (!form.slug.trim()) {
      toast.error(t('Name is required'))
      return
    }
    if (!form.aliases.trim()) {
      toast.error(t('Aliases are required'))
      return
    }
    const payload: RoutingProfileFormValues = {
      ...form,
      ...fromTierRows(tierRows),
    }
    setSubmitting(true)
    try {
      const res =
        editingId == null
          ? await createRoutingProfile(payload)
          : await updateRoutingProfile({ ...payload, id: editingId })
      if (res.success) {
        toast.success(
          editingId == null
            ? t('Routing profile created')
            : t('Routing profile updated')
        )
        setEditorOpen(false)
        load()
      }
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async () => {
    if (!deleting) return
    const res = await deleteRoutingProfile(deleting.id)
    if (res.success) {
      toast.success(t('Routing profile deleted'))
      setDeleting(null)
      load()
    }
  }

  // 把 tier 值渲染成人类可读标签：mg:<id> -> 分组名（找不到分组则原样 mg:<id>），
  // 老的原始模型名则原样展示。
  const groupNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const g of groups) map.set(g.id, g.name)
    return map
  }, [groups])

  const tierLabel = useCallback(
    (v: string) => {
      const value = v?.trim()
      if (!value) return ''
      const m = /^mg:(\d+)$/.exec(value)
      if (m) return groupNameById.get(Number(m[1])) ?? value
      return value
    },
    [groupNameById]
  )

  const tierSummary = (p: RoutingProfile) =>
    [
      p.tier_1_model,
      p.tier_2_model,
      p.tier_3_model,
      p.tier_4_model,
      p.tier_5_model,
    ]
      .map(tierLabel)
      .filter(Boolean)
      .join(' · ') || '—'

  // 客户端分页：路由 profile 一次全量拉取、数量不多,用 react-table 做本地分页,
  // 复用与其它表一致的分页页脚。
  const table = useReactTable({
    data: profiles,
    columns: EMPTY_COLUMNS,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  const pagedProfiles = table.getRowModel().rows.map((row) => row.original)

  // 删除后当前页可能越界,回退到最后一页。
  const pageCount = table.getPageCount()
  useEffect(() => {
    if (pagination.pageIndex > 0 && pagination.pageIndex > pageCount - 1) {
      setPagination((prev) => ({
        ...prev,
        pageIndex: Math.max(0, pageCount - 1),
      }))
    }
  }, [pageCount, pagination.pageIndex])

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Routing Profiles')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='pill'
            onClick={load}
            disabled={loading}
          >
            <RefreshCw className='size-4' />
            {t('Refresh')}
          </Button>
          <Button size='pill' onClick={openCreate}>
            <Plus className='size-4' />
            {t('Create Routing Profile')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <p className='text-muted-foreground mb-3 text-sm'>
            {t(
              'Smart routing: requests whose model matches an alias (e.g. "auto") are scored by tierflow-infer, then routed to the tier model matching the difficulty band.'
            )}
          </p>
          <div className='border-border bg-background overflow-hidden rounded-2xl border'>
            <div
              className={cn(
                // Unified single-card look shared with the channels / keys /
                // usage-log / models tables: one uniform 14px body size,
                // unbolded sticky muted header, roomier rows.
                '[&_[data-slot=table]]:text-[14px] [&_[data-slot=table]_td]:text-[14px] [&_[data-slot=table]_td_*]:text-[14px] [&_[data-slot=table]_th]:text-[14px] [&_[data-slot=table]_th_*]:text-[14px]',
                '[&_[data-slot=table]_th]:font-normal',
                // 与 DataTablePage 列表表格一致的 54px 行高(见 data-table/row-metrics.ts)
                '[&_[data-slot=table]_th]:h-[54px] [&_[data-slot=table]_th]:px-4 [&_[data-slot=table]_th]:leading-[22px]',
                '[&_[data-slot=table]_td]:px-4 [&_[data-slot=table]_td]:py-4 [&_[data-slot=table]_td]:leading-[22px]'
              )}
            >
              <Table>
                <TableHeader className='bg-muted [&_th]:text-foreground sticky top-0 z-10'>
                  <TableRow>
                    <TableHead>{t('Name')}</TableHead>
                    <TableHead>{t('Aliases')}</TableHead>
                    <TableHead>{t('Tier Models')}</TableHead>
                    <TableHead>{t('Keywords')}</TableHead>
                    <TableHead>{t('Status')}</TableHead>
                    <TableHead className='text-right'>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profiles.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className='text-muted-foreground !py-10 text-center'
                      >
                        {loading
                          ? t('Loading...')
                          : t('No routing profiles yet')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    pagedProfiles.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className='font-medium'>{p.slug}</TableCell>
                        <TableCell>{p.aliases}</TableCell>
                        <TableCell className='max-w-xs truncate'>
                          {tierSummary(p)}
                        </TableCell>
                        <TableCell>
                          {parseKeywords(p.keywords).length === 0 ? (
                            <span className='text-muted-foreground'>—</span>
                          ) : (
                            <div className='flex max-w-[220px] flex-wrap gap-1'>
                              {parseKeywords(p.keywords).map((kw, idx) => (
                                <StatusBadge
                                  key={idx}
                                  label={kw}
                                  autoColor={kw}
                                  size='sm'
                                  copyable={false}
                                />
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            label={p.enabled ? t('Enabled') : t('Disabled')}
                            variant={p.enabled ? 'success' : 'neutral'}
                            size='sm'
                            copyable={false}
                          />
                        </TableCell>
                        <TableCell className='text-right'>
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => openEdit(p)}
                          >
                            <Pencil className='size-4' />
                          </Button>
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => setDeleting(p)}
                          >
                            <Trash2 className='text-destructive size-4' />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {profiles.length > 0 && (
              <div className='px-2 py-2'>
                <DataTablePagination table={table} />
              </div>
            )}
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {/* 创建 / 编辑 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editingId == null
                ? t('Create Routing Profile')
                : t('Edit Routing Profile')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Each tier maps a difficulty score range (0-10) to a model group. Tier 1 = hardest, Tier 5 = cheapest; Tier 3 is the fallback.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 py-2'>
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label>{t('Name')}</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setField('slug', e.target.value)}
                  placeholder='default-auto'
                />
                <p className='text-muted-foreground text-xs'>
                  {t('Unique identifier, used in request logs and dashboards.')}
                </p>
              </div>
              <div className='grid gap-1.5'>
                <Label>{t('Aliases')}</Label>
                <Input
                  value={form.aliases}
                  onChange={(e) => setField('aliases', e.target.value)}
                  placeholder='auto,tierflow-auto'
                />
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Comma-separated model names users call to trigger this profile.'
                  )}
                </p>
              </div>
            </div>

            {/* 难度档位：每档 起 / 止 / 模型组 */}
            <div className='grid gap-2'>
              <Label>{t('Difficulty tiers')}</Label>
              <div className='border-border overflow-hidden rounded-lg border'>
                <div className='text-muted-foreground bg-muted grid grid-cols-[auto_1fr_1fr_2fr] items-center gap-2 px-3 py-2 text-xs'>
                  <span className='w-16'>{t('Tier')}</span>
                  <span>{t('Score from')}</span>
                  <span>{t('Score to')}</span>
                  <span>{t('Model group')}</span>
                </div>
                <div className='divide-border divide-y'>
                  {TIER_META.map((meta, i) => (
                    <div
                      key={meta.tier}
                      className='grid grid-cols-[auto_1fr_1fr_2fr] items-center gap-2 px-3 py-2'
                    >
                      <div className='flex w-16 flex-col'>
                        <span className='text-sm font-medium'>
                          {`Tier ${meta.tier}`}
                        </span>
                        {meta.noteKey && (
                          <span className='text-muted-foreground text-xs'>
                            {t(meta.noteKey)}
                          </span>
                        )}
                      </div>
                      <Input
                        type='number'
                        min={0}
                        max={10}
                        className='tabular-nums'
                        value={tierRows[i]?.start ?? ''}
                        onChange={(e) =>
                          setTierField(i, 'start', e.target.value)
                        }
                      />
                      <Input
                        type='number'
                        min={0}
                        max={10}
                        className='tabular-nums'
                        value={tierRows[i]?.end ?? ''}
                        onChange={(e) => setTierField(i, 'end', e.target.value)}
                      />
                      <div className='flex flex-col gap-1'>
                        <SingleSelect
                          options={modelOptions}
                          value={tierRows[i]?.model ?? ''}
                          onValueChange={(v) => setTierField(i, 'model', v)}
                          placeholder={t('Select a model group')}
                          emptyText={t('No model groups. Create one first.')}
                        />
                        {!isKnownGroup(tierRows[i]?.model ?? '') && (
                          <span className='text-xs text-amber-600'>
                            {t('Legacy model value — reselect a model group')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className='text-muted-foreground text-xs'>
                {t('Score range is 0-10. Leave a tier empty to skip it.')}
              </p>
            </div>

            <div className='grid gap-1.5'>
              <Label>{t('Multimodal model (image/audio input)')}</Label>
              <SingleSelect
                options={modelOptions}
                value={form.multimodal_model}
                onValueChange={(v) => setField('multimodal_model', v)}
                placeholder={t('Select a model group')}
                emptyText={t('No model groups. Create one first.')}
              />
              {!isKnownGroup(form.multimodal_model) && (
                <span className='text-xs text-amber-600'>
                  {t('Legacy model value — reselect a model group')}
                </span>
              )}
              <p className='text-muted-foreground text-xs'>
                {t(
                  'When the request contains images/audio, route straight to this model (skips scoring). Leave empty to disable.'
                )}
              </p>
            </div>

            <div className='grid gap-1.5'>
              <Label>{t('Group (optional)')}</Label>
              <SingleSelect
                options={groupOptions}
                value={form.group}
                onValueChange={(v) => setField('group', v)}
                placeholder={t('Select a group (optional)')}
                emptyText={t('No groups available')}
              />
            </div>

            <div className='grid gap-1.5'>
              <Label>{t('Description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={2}
              />
            </div>

            <div className='grid gap-1.5'>
              <Label>{t('Keywords')}</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setField('keywords', e.target.value)}
                placeholder={t('e.g. Coding;Long context;Agent')}
              />
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Semicolon-separated keywords shown under this strategy card in the model square.'
                )}
              </p>
            </div>

            <div className='flex items-center gap-2'>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => setField('enabled', v)}
              />
              <Label>{t('Enabled')}</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setEditorOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={onSubmit} disabled={submitting}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('Delete Routing Profile')}</DialogTitle>
            <DialogDescription>
              {t('Are you sure you want to delete "{{name}}"?', {
                name: deleting?.slug ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDeleting(null)}>
              {t('Cancel')}
            </Button>
            <Button variant='destructive' onClick={onDelete}>
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
