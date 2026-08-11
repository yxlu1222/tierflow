/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 套餐模型组管理 —— 套餐额度桶(高级/基础)引用的模型组集合。
 * 分层:套餐 → 套餐模型组 → 模型组(同一模型的多上游花名册) → 上游渠道。
 * 集合数量少(个位数),用卡片列表 + 弹窗表单,不上数据表格。
 */
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { MultiSelect } from '@/components/multi-select'
import {
  createPlanModelSet,
  deletePlanModelSet,
  getModelGroupsForPicker,
  getPlanModelSets,
  updatePlanModelSet,
  type PlanModelSet,
} from './api'

interface FormState {
  id: number | null
  name: string
  description: string
  enabled: boolean
  groupIds: string[]
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  description: '',
  enabled: true,
  groupIds: [],
}

export function PlanModelSets() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<PlanModelSet | null>(null)

  const { data, isLoading: loading } = useQuery({
    queryKey: ['plan-model-sets'],
    queryFn: async () => {
      const [setsRes, groupsRes] = await Promise.all([
        getPlanModelSets(),
        getModelGroupsForPicker(),
      ])
      return {
        sets: setsRes.success ? setsRes.data || [] : [],
        groups: groupsRes.success ? groupsRes.data || [] : [],
      }
    },
  })
  const sets = data?.sets ?? []
  const groups = useMemo(() => data?.groups ?? [], [data])
  const load = () =>
    queryClient.invalidateQueries({ queryKey: ['plan-model-sets'] })

  const groupNameById = useMemo(() => {
    const m = new Map<number, string>()
    groups.forEach((g) => m.set(g.id, g.name))
    return m
  }, [groups])

  const groupOptions = useMemo(
    () =>
      groups.map((g) => ({
        label: g.enabled ? g.name : `${g.name} (${t('Disabled')})`,
        value: String(g.id),
      })),
    [groups, t]
  )

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (s: PlanModelSet) => {
    setForm({
      id: s.id,
      name: s.name,
      description: s.description || '',
      enabled: s.enabled,
      groupIds: (s.members || []).map((m) => String(m.model_group_id)),
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error(t('Name is required'))
      return
    }
    setSaving(true)
    try {
      const payload = {
        name,
        description: form.description,
        enabled: form.enabled,
        members: form.groupIds.map((id) => ({ model_group_id: Number(id) })),
      }
      const res = form.id
        ? await updatePlanModelSet({ ...payload, id: form.id })
        : await createPlanModelSet(payload)
      if (res.success) {
        toast.success(
          form.id ? t('Updated successfully') : t('Created successfully')
        )
        setDialogOpen(false)
        void load()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await deletePlanModelSet(deleteTarget.id)
      if (res.success) {
        toast.success(t('Deleted successfully'))
        void load()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Bundle model groups into sets referenced by plan quota buckets (premium / basic).'
          )}
        </p>
        <Button onClick={openCreate}>
          <Plus className='mr-1 h-4 w-4' />
          {t('New Set')}
        </Button>
      </div>

      {loading ? (
        <div className='text-muted-foreground flex items-center gap-2 py-10 text-sm'>
          <Loader2 className='h-4 w-4 animate-spin' />
          {t('Loading...')}
        </div>
      ) : sets.length === 0 ? (
        <Card>
          <CardContent className='text-muted-foreground py-10 text-center text-sm'>
            {t('No plan model sets yet. Create one to get started.')}
          </CardContent>
        </Card>
      ) : (
        <div className='grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'>
          {sets.map((s) => (
            <Card key={s.id}>
              <CardHeader className='pb-2'>
                <div className='flex items-start justify-between gap-2'>
                  <CardTitle className='flex items-center gap-2 text-base'>
                    <Layers className='text-muted-foreground h-4 w-4' />
                    {s.name}
                    {!s.enabled && (
                      <Badge variant='secondary'>{t('Disabled')}</Badge>
                    )}
                  </CardTitle>
                  <div className='flex gap-1'>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='h-8 w-8'
                      onClick={() => openEdit(s)}
                    >
                      <Pencil className='h-4 w-4' />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='text-destructive h-8 w-8'
                      onClick={() => setDeleteTarget(s)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </div>
                </div>
                {s.description && (
                  <p className='text-muted-foreground text-xs'>
                    {s.description}
                  </p>
                )}
              </CardHeader>
              <CardContent>
                <div className='flex flex-wrap gap-1.5'>
                  {(s.members || []).length === 0 ? (
                    <span className='text-muted-foreground text-xs'>
                      {t('No model groups')}
                    </span>
                  ) : (
                    (s.members || []).map((m) => (
                      <Badge key={m.model_group_id} variant='outline'>
                        {groupNameById.get(m.model_group_id) ||
                          `#${m.model_group_id}`}
                      </Badge>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {form.id ? t('Edit Plan Model Set') : t('New Plan Model Set')}
            </DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label>{t('Name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('e.g. premium-models')}
              />
            </div>
            <div className='space-y-2'>
              <Label>{t('Description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={2}
              />
            </div>
            <div className='space-y-2'>
              <Label>{t('Model Groups')}</Label>
              <MultiSelect
                options={groupOptions}
                selected={form.groupIds}
                onChange={(values: string[]) =>
                  setForm({ ...form, groupIds: values })
                }
                placeholder={t('Select model groups')}
              />
            </div>
            <div className='flex items-center justify-between'>
              <Label>{t('Enabled')}</Label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) =>
                  setForm({ ...form, enabled: checked })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialogOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className='mr-1 h-4 w-4 animate-spin' />}
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open: boolean) => !open && setDeleteTarget(null)}
        title={t('Delete Plan Model Set')}
        desc={t(
          'This set will be removed. Plans referencing it must be updated first.'
        )}
        destructive
        handleConfirm={handleDelete}
      />
    </div>
  )
}
