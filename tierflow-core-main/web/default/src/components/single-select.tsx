/*
Copyright (C) 2023-2026 TierFlow
*/
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export type SingleSelectOption = {
  value: string
  label: string
  icon?: React.ReactNode
}

interface SingleSelectProps {
  options: SingleSelectOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  /** Empty-state text shown when the search yields no matches. */
  emptyText?: string
  className?: string
  id?: string
  disabled?: boolean
  /** Show an inline clear button when a value is selected. Defaults to true. */
  clearable?: boolean
}

/**
 * SingleSelect — searchable single-select built on Base UI Combobox.
 *
 * Unlike the legacy hand-rolled `ComboboxInput`, the dropdown is rendered
 * through Base UI's Portal/floating tree. That makes it immune to being
 * clipped or covered by ancestors with `overflow: hidden` / `overflow: auto`
 * (e.g. dialog bodies and bordered table wrappers), so every candidate stays
 * visible and clickable no matter how long the list is. It also participates
 * in the dialog's dismiss tree, so clicking an option never closes the dialog.
 *
 * Display/search use the option label (via `itemToStringLabel`) while the
 * stored/emitted value stays the option `value`. An externally-supplied value
 * that is not present in `options` (e.g. a legacy stored value) is displayed
 * verbatim, matching the previous component's behaviour.
 */
export function SingleSelect(props: SingleSelectProps) {
  const { t } = useTranslation()
  const clearable = props.clearable ?? true

  const labelMap = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const option of props.options) {
      map.set(option.value, option.label)
    }
    return map
  }, [props.options])

  const iconMap = React.useMemo(() => {
    const map = new Map<string, React.ReactNode>()
    for (const option of props.options) {
      if (option.icon) map.set(option.value, option.icon)
    }
    return map
  }, [props.options])

  const items = React.useMemo(
    () => props.options.map((option) => option.value),
    [props.options]
  )

  return (
    <Combobox
      items={items}
      value={props.value ?? ''}
      onValueChange={(value) =>
        props.onValueChange((value as string | null) ?? '')
      }
      itemToStringLabel={(value: string) => labelMap.get(value) ?? value}
      disabled={props.disabled}
    >
      <ComboboxInput
        id={props.id}
        placeholder={props.placeholder}
        className={props.className}
        showClear={clearable && !!props.value}
      />
      <ComboboxContent forceDark={false}>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {iconMap.get(item) && <span>{iconMap.get(item)}</span>}
              <span className='truncate'>{labelMap.get(item) ?? item}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
        <ComboboxEmpty>
          {props.emptyText ?? t('No matching items')}
        </ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  )
}
