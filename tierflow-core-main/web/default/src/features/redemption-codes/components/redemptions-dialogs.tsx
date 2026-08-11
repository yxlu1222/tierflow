/*
Copyright (C) 2023-2026 TierFlow
*/
import { RedemptionsDeleteDialog } from './redemptions-delete-dialog'
import { RedemptionsMutateDialog } from './redemptions-mutate-dialog'
import { useRedemptions } from './redemptions-provider'

export function RedemptionsDialogs() {
  const { open, setOpen, currentRow } = useRedemptions()
  const isUpdate = open === 'update'

  return (
    <>
      <RedemptionsMutateDialog
        open={open === 'create' || isUpdate}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={isUpdate ? currentRow || undefined : undefined}
      />
      <RedemptionsDeleteDialog />
    </>
  )
}
