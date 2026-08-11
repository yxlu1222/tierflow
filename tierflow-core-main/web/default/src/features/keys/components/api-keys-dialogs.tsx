/*
Copyright (C) 2023-2026 TierFlow
*/
import { ApiKeysDeleteDialog } from './api-keys-delete-dialog'
import { ApiKeysDetailDialog } from './api-keys-detail-dialog'
import { ApiKeysMutateDrawer } from './api-keys-mutate-drawer'
import { useApiKeys } from './api-keys-provider'

export function ApiKeysDialogs() {
  const { open, setOpen, currentRow } = useApiKeys()

  return (
    <>
      <ApiKeysMutateDrawer
        open={open === 'create' || open === 'update'}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        currentRow={open === 'update' ? currentRow || undefined : undefined}
      />
      <ApiKeysDeleteDialog />
      <ApiKeysDetailDialog />
    </>
  )
}
