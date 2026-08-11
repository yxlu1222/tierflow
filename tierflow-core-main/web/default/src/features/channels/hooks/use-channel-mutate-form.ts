/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { createChannel, updateChannel } from '../api'
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants'
import {
  transformFormDataToCreatePayload,
  transformFormDataToUpdatePayload,
  type ChannelFormValues,
} from '../lib'
import type { Channel } from '../types'

type UseChannelMutateFormParams = {
  currentRow?: Channel | null
  isEditing: boolean
  isMultiKeyChannel: boolean
  onSuccess: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message
  }

  if (!isRecord(error)) return undefined

  const response = error.response
  if (isRecord(response)) {
    const data = response.data
    if (isRecord(data)) {
      const message = data.message
      if (typeof message === 'string') return message
    }
  }

  const message = error.message
  if (typeof message === 'string') return message
  return undefined
}

export function useChannelMutateForm(props: UseChannelMutateFormParams) {
  const { t } = useTranslation()

  return useMutation({
    mutationFn: async (data: ChannelFormValues): Promise<string> => {
      if (props.isEditing && props.currentRow) {
        const payload = transformFormDataToUpdatePayload(
          data,
          props.currentRow.id
        )
        const payloadWithKeyMode =
          props.isMultiKeyChannel && data.key_mode
            ? {
                ...payload,
                key_mode: data.key_mode,
              }
            : payload

        const response = await updateChannel(
          props.currentRow.id,
          payloadWithKeyMode
        )
        if (!response.success) {
          throw new Error(response.message || t(ERROR_MESSAGES.UPDATE_FAILED))
        }
        return SUCCESS_MESSAGES.UPDATED
      }

      const payload = transformFormDataToCreatePayload(data)
      const response = await createChannel(payload)
      if (!response.success) {
        throw new Error(response.message || t(ERROR_MESSAGES.CREATE_FAILED))
      }
      return SUCCESS_MESSAGES.CREATED
    },
    onSuccess: (messageKey) => {
      toast.success(t(messageKey))
      props.onSuccess()
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error) || t(ERROR_MESSAGES.CREATE_FAILED))
    },
  })
}
