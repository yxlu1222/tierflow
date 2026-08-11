/*
Copyright (C) 2023-2026 TierFlow
*/
import React from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSearch } from '@/context/search-provider'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { ScrollArea } from './ui/scroll-area'

export function CommandMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { open, setOpen } = useSearch()

  // Reuse the resolved sidebar view so the palette shows exactly the same
  // entries as the sidebar: the active nested view when one matches, or the
  // root navigation already narrowed by role (admin-only groups).
  const { navGroups } = useSidebarView()

  const runCommand = React.useCallback(
    (command: () => unknown) => {
      setOpen(false)
      command()
    },
    [setOpen]
  )

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder={t('Type a command or search...')} />
        <CommandList>
          <ScrollArea className='h-72 pe-1'>
            <CommandEmpty>{t('No results found.')}</CommandEmpty>
            {navGroups.map((group) => (
              <CommandGroup key={group.id || group.title} heading={group.title}>
                {group.items.map((navItem, i) => {
                  if (navItem.url)
                    return (
                      <CommandItem
                        key={`${navItem.url}-${i}`}
                        value={navItem.title}
                        onSelect={() => {
                          runCommand(() => navigate({ to: navItem.url }))
                        }}
                      >
                        <div className='flex size-4 items-center justify-center'>
                          <ArrowRight className='text-muted-foreground/80 size-2' />
                        </div>
                        {navItem.title}
                      </CommandItem>
                    )

                  return navItem.items?.map((subItem, i) => (
                    <CommandItem
                      key={`${navItem.title}-${subItem.url}-${i}`}
                      value={`${navItem.title}-${subItem.url}`}
                      onSelect={() => {
                        runCommand(() => navigate({ to: subItem.url }))
                      }}
                    >
                      <div className='flex size-4 items-center justify-center'>
                        <ArrowRight className='text-muted-foreground/80 size-2' />
                      </div>
                      {navItem.title} <ChevronRight /> {subItem.title}
                    </CommandItem>
                  ))
                })}
              </CommandGroup>
            ))}
          </ScrollArea>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
