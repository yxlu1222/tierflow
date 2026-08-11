/*
Copyright (C) 2023-2026 TierFlow
*/
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getLobeIcon } from '@/lib/lobe-icon'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/status-badge'
import { deleteVendor, getVendors } from '../api'
import { vendorsQueryKeys } from '../lib'
import type { Vendor } from '../types'
import { useModels } from './models-provider'

/**
 * Vendors management tab — full CRUD list (create via the shared
 * VendorMutateDialog, plus inline edit/delete), in the same unified Console
 * card look as the Model Groups tab. Replaces the old ⋯ "Manage Vendors" menu
 * item that could only create.
 */
export function VendorsTable() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { setOpen, setCurrentVendor } = useModels()
  const [deleting, setDeleting] = useState<Vendor | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: vendorsQueryKeys.list(),
    queryFn: () => getVendors({ page_size: 1000 }),
  })
  const vendors = data?.data?.items ?? []

  const openCreate = () => {
    setCurrentVendor(null)
    setOpen('create-vendor')
  }

  const openEdit = (v: Vendor) => {
    setCurrentVendor(v)
    setOpen('update-vendor')
  }

  const onDelete = async () => {
    if (!deleting) return
    const res = await deleteVendor(deleting.id)
    if (res.success) {
      toast.success(t('Vendor deleted'))
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: vendorsQueryKeys.all })
    } else {
      toast.error(res.message || t('Failed to delete vendor'))
    }
  }

  return (
    <>
      <div className='space-y-3'>
        <div className='flex justify-end'>
          <Button size='pill' onClick={openCreate}>
            <Plus className='size-4' />
            {t('Create Vendor')}
          </Button>
        </div>

        <div className='border-border bg-background overflow-hidden rounded-2xl border'>
          <div className='overflow-x-auto [&_td]:py-3.5 [&_td]:text-[14px] [&_th]:text-[14px] [&_th]:font-normal [&_th]:text-foreground'>
            <Table>
              <TableHeader className='bg-muted'>
                <TableRow>
                  <TableHead className='w-16'>{t('ID')}</TableHead>
                  <TableHead>{t('Name')}</TableHead>
                  <TableHead>{t('Description')}</TableHead>
                  <TableHead>{t('Status')}</TableHead>
                  <TableHead className='text-right'>{t('Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className='text-muted-foreground py-10 text-center'
                    >
                      {isLoading ? t('Loading...') : t('No vendors yet')}
                    </TableCell>
                  </TableRow>
                ) : (
                  vendors.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className='text-muted-foreground font-mono'>
                        {v.id}
                      </TableCell>
                      <TableCell className='font-medium'>
                        <span className='flex items-center gap-2'>
                          {v.icon ? getLobeIcon(v.icon, 18) : null}
                          {v.name}
                        </span>
                      </TableCell>
                      <TableCell className='text-muted-foreground max-w-xs truncate'>
                        {v.description || '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          variant={v.status === 1 ? 'success' : 'neutral'}
                          size='sm'
                          copyable={false}
                          label={v.status === 1 ? t('Enabled') : t('Disabled')}
                        />
                      </TableCell>
                      <TableCell className='text-right'>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => openEdit(v)}
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => setDeleting(v)}
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
        </div>
      </div>

      {/* 删除确认 */}
      <Dialog
        open={deleting != null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t('Delete Vendor')}</DialogTitle>
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
    </>
  )
}
