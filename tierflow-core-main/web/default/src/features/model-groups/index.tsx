/*
Copyright (C) 2023-2026 TierFlow
*/
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
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
import { Textarea } from '@/components/ui/textarea'
import type { Channel } from '@/features/channels/types'
import { getRouteHealth } from '@/features/route-monitor/api'
import type { ProviderHealth } from '@/features/route-monitor/types'
import {
  createModelGroup,
  deleteModelGroup,
  getChannelsForPicker,
  getModelGroups,
  updateModelGroup,
} from './api'
import {
  GroupHealthCards,
  GroupHealthDetailDialog,
} from './components/group-health'
import { buildChannelHealthMap, type GroupHealth } from './lib/group-health'
import type {
  MemberFormRow,
  ModelGroup,
  ModelGroupFormValues,
} from './types'

const EMPTY_FORM: ModelGroupFormValues = {
  name: '',
  description: '',
  enabled: true,
  members: [],
}

let rowSeq = 0
function nextRowKey() {
  rowSeq += 1
  return `row-${rowSeq}`
}

function newMemberRow(): MemberFormRow {
  return {
    rowKey: nextRowKey(),
    channel_id: null,
    model_name: '',
    priority: 0,
  }
}

// 把后端分组折叠成表单成员行。
function toFormValues(g: ModelGroup): ModelGroupFormValues {
  return {
    name: g.name,
    description: g.description,
    enabled: g.enabled,
    members: (g.members ?? []).map((m) => ({
      rowKey: nextRowKey(),
      channel_id: m.channel_id,
      model_name: m.model_name,
      priority: m.priority ?? 0,
    })),
  }
}

export function ModelGroups() {
  const { t } = useTranslation()
  const [groups, setGroups] = useState<ModelGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [channels, setChannels] = useState<Channel[]>([])
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([])
  const [detail, setDetail] = useState<{
    group: ModelGroup
    health: GroupHealth
  } | null>(null)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<ModelGroupFormValues>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const [deleting, setDeleting] = useState<ModelGroup | null>(null)
  const [toggling, setToggling] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getModelGroups()
      if (res.success) setGroups(res.data || [])
      // 渠道实时健康是尽力而为：拉不到也不影响分组列表本身。
      try {
        const hp = await getRouteHealth()
        if (hp.success && hp.data) setProviderHealth(hp.data.providers || [])
      } catch {
        /* ignore health fetch failure */
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    getChannelsForPicker()
      .then((res) => {
        if (res.success) setChannels(res.data?.items || [])
      })
      .catch(() => {})
  }, [load])

  // 渠道下拉选项。
  const channelOptions = useMemo(
    () =>
      channels.map((c) => ({
        label: `#${c.id} ${c.name}`,
        value: String(c.id),
      })),
    [channels]
  )

  // 渠道健康映射（channel_id -> 实时状态）与渠道名映射，供健康卡片/详情使用。
  const healthByChannel = useMemo(
    () => buildChannelHealthMap(providerHealth),
    [providerHealth]
  )
  const channelNameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const c of channels) map.set(c.id, c.name)
    return map
  }, [channels])

  // channelId -> 该渠道承载的模型名（用于成员行的模型下拉）。
  const channelModelOptions = useCallback(
    (channelId: number | null) => {
      if (channelId == null) return []
      const ch = channels.find((c) => c.id === channelId)
      if (!ch?.models) return []
      return ch.models
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean)
        .map((m) => ({ label: m, value: m }))
    },
    [channels]
  )

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM, members: [] })
    setEditorOpen(true)
  }

  const openEdit = (g: ModelGroup) => {
    setEditingId(g.id)
    setForm(toFormValues(g))
    setEditorOpen(true)
  }

  const setField = <K extends keyof ModelGroupFormValues>(
    key: K,
    value: ModelGroupFormValues[K]
  ) => setForm((prev) => ({ ...prev, [key]: value }))

  const updateMember = (
    rowKey: string,
    patch: Partial<MemberFormRow>
  ) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        m.rowKey === rowKey ? { ...m, ...patch } : m
      ),
    }))

  const addMember = () =>
    setForm((prev) => ({ ...prev, members: [...prev.members, newMemberRow()] }))

  const removeMember = (rowKey: string) =>
    setForm((prev) => ({
      ...prev,
      members: prev.members.filter((m) => m.rowKey !== rowKey),
    }))

  const onSubmit = async () => {
    if (!form.name.trim()) {
      toast.error(t('Name is required'))
      return
    }
    // 校验成员：渠道 + 模型必填。
    for (const m of form.members) {
      if (m.channel_id == null || !m.model_name.trim()) {
        toast.error(t('Each member needs a channel and a model.'))
        return
      }
    }
    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        enabled: form.enabled,
        members: form.members.map((m) => ({
          channel_id: m.channel_id as number,
          model_name: m.model_name.trim(),
          priority: Number(m.priority) || 0,
        })),
      }
      const res =
        editingId == null
          ? await createModelGroup(payload)
          : await updateModelGroup({ ...payload, id: editingId })
      if (!res.success) {
        // 后端校验失败（成员不是已启用 ability 等）会返回 message。
        toast.error(res.message || t('Failed to save model group'))
        return
      }
      toast.success(
        editingId == null
          ? t('Model group created')
          : t('Model group updated')
      )
      setEditorOpen(false)
      load()
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async () => {
    if (!deleting) return
    const res = await deleteModelGroup(deleting.id)
    if (res.success) {
      toast.success(t('Model group deleted'))
      setDeleting(null)
      load()
    } else {
      toast.error(res.message || t('Failed to delete model group'))
    }
  }

  // 详情弹窗里的启用/停用：整体 PUT（后端 Update 是全字段 Save），只翻转 enabled。
  // 停用的组不进路由缓存，等同于从路由中摘除。
  const onToggleEnabled = async (g: ModelGroup) => {
    setToggling(true)
    try {
      const next = !g.enabled
      const res = await updateModelGroup({
        id: g.id,
        name: g.name,
        description: g.description,
        enabled: next,
        members: (g.members ?? []).map((m) => ({
          channel_id: m.channel_id,
          model_name: m.model_name,
          priority: m.priority ?? 0,
        })),
      })
      if (res.success) {
        toast.success(next ? t('Model group enabled') : t('Model group disabled'))
        setDetail(null)
        load()
      } else {
        toast.error(res.message || t('Failed to save model group'))
      }
    } finally {
      setToggling(false)
    }
  }

  return (
    <>
      <div className='space-y-3'>
        <div className='flex flex-wrap items-start justify-between gap-2'>
          <p className='text-muted-foreground max-w-3xl text-sm'>
            {t(
              'A model group bundles (channel, model) members for routing and failover. Pricing and cost are configured per model on the Model Management page.'
            )}
          </p>
          <div className='flex shrink-0 items-center gap-2'>
            <Button
              variant='outline'
              size='pill'
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              {t('Refresh')}
            </Button>
            <Button size='pill' onClick={openCreate}>
              <Plus className='size-4' />
              {t('Create Model Group')}
            </Button>
          </div>
        </div>
        <GroupHealthCards
          groups={groups}
          healthByChannel={healthByChannel}
          channelNameById={channelNameById}
          loading={loading}
          onSelect={(group, health) => setDetail({ group, health })}
        />
        {!loading && groups.length === 0 && (
          <div className='border-border text-muted-foreground rounded-2xl border py-14 text-center text-sm'>
            {t('No model groups yet')}
          </div>
        )}
      </div>

      {/* 创建 / 编辑 */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
          <DialogHeader>
            <DialogTitle>
              {editingId == null
                ? t('Create Model Group')
                : t('Edit Model Group')}
            </DialogTitle>
            <DialogDescription>
              {t(
                'Members are (channel, model) pairs. Each must exist as an enabled ability.'
              )}
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4 py-2'>
            <div className='grid grid-cols-2 gap-4'>
              <div className='grid gap-1.5'>
                <Label>{t('Name')}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder={t('Display name')}
                />
              </div>
              <div className='flex items-end gap-2 pb-1.5'>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setField('enabled', v)}
                />
                <Label>{t('Enabled')}</Label>
              </div>
            </div>

            <div className='grid gap-1.5'>
              <Label>{t('Description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={2}
              />
            </div>

            <div className='flex items-center justify-between'>
              <Label>{t('Members')}</Label>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={addMember}
              >
                <Plus className='size-4' />
                {t('Add member')}
              </Button>
            </div>

            {form.members.length === 0 ? (
              <p className='text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm'>
                {t('No members yet. Add a (channel, model) pair.')}
              </p>
            ) : (
              <div className='flex flex-col gap-3'>
                {form.members.map((m) => (
                  <div
                    key={m.rowKey}
                    className='relative grid gap-3 rounded-lg border p-3'
                  >
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='absolute right-1 top-1 size-7'
                      onClick={() => removeMember(m.rowKey)}
                    >
                      <X className='size-4' />
                    </Button>
                    <div className='grid gap-3 pr-8 sm:grid-cols-3'>
                      <div className='grid gap-1.5'>
                        <Label className='text-xs'>{t('Channel')}</Label>
                        <Combobox
                          options={channelOptions}
                          value={
                            m.channel_id == null ? '' : String(m.channel_id)
                          }
                          onValueChange={(v) =>
                            updateMember(m.rowKey, {
                              channel_id: v ? Number(v) : null,
                              // 切换渠道后清空原模型（可能不再属于新渠道）。
                              model_name: '',
                            })
                          }
                          placeholder={t('Select a channel')}
                          searchPlaceholder={t('Search channels...')}
                          emptyText={t('No channels')}
                        />
                      </div>
                      <div className='grid gap-1.5'>
                        <Label className='text-xs'>{t('Model')}</Label>
                        <Combobox
                          options={channelModelOptions(m.channel_id)}
                          value={m.model_name}
                          onValueChange={(v) =>
                            updateMember(m.rowKey, { model_name: v ?? '' })
                          }
                          placeholder={t('Select or type a model')}
                          searchPlaceholder={t('Search models...')}
                          emptyText={t('No models on this channel')}
                          allowCustomValue
                        />
                      </div>
                      <div className='grid gap-1.5'>
                        <Label className='text-xs'>{t('Priority')}</Label>
                        <Input
                          type='number'
                          value={m.priority}
                          onChange={(e) =>
                            updateMember(m.rowKey, {
                              priority: Number(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
            <DialogTitle>{t('Delete Model Group')}</DialogTitle>
            <DialogDescription>
              {t('Are you sure you want to delete "{{name}}"?', {
                name: deleting?.name ?? '',
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

      {/* 模型组健康详情 */}
      <GroupHealthDetailDialog
        group={detail?.group ?? null}
        health={detail?.health ?? null}
        open={detail != null}
        onOpenChange={(o) => !o && setDetail(null)}
        toggling={toggling}
        // 编辑/删除都会打开另一个弹窗，先关掉详情，避免弹窗叠弹窗
        onEdit={(g) => {
          setDetail(null)
          openEdit(g)
        }}
        onToggleEnabled={onToggleEnabled}
        onDelete={(g) => {
          setDetail(null)
          setDeleting(g)
        }}
      />
    </>
  )
}
