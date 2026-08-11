/*
Copyright (C) 2023-2026 TierFlow
*/
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Markdown } from '@/components/ui/markdown'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { DateTimePicker } from '@/components/datetime-picker'
import { useAnnouncementsData } from './use-announcements-data'
import { type AnnouncementFormValues, getAnnouncementSchema } from './types'

const DEFAULT_VALUES: AnnouncementFormValues = {
  title: '',
  category: '',
  content: '',
  publishDate: new Date().toISOString(),
  status: 'published',
  pinned: false,
}

export function AnnouncementEditor({ id }: { id?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { announcements, isLoading, save, isPending } = useAnnouncementsData()
  const editingId = id != null ? Number(id) : undefined
  const isUpdate = editingId != null

  const editing = useMemo(
    () =>
      editingId != null
        ? announcements.find((a) => a.id === editingId)
        : undefined,
    [announcements, editingId]
  )

  const [ready, setReady] = useState(!isUpdate)

  const form = useForm<AnnouncementFormValues>({
    resolver: zodResolver(getAnnouncementSchema(t)),
    defaultValues: DEFAULT_VALUES,
  })

  // Populate the form once the target announcement is loaded (edit mode).
  useEffect(() => {
    if (!isUpdate || ready) return
    if (editing) {
      form.reset({
        title: editing.title,
        category: editing.category,
        content: editing.content,
        publishDate: editing.publishDate,
        status: editing.status,
        pinned: editing.pinned,
      })
      setReady(true)
    }
  }, [isUpdate, ready, editing, form])

  const goBack = () => navigate({ to: '/announcements' })

  const onSubmit = async (values: AnnouncementFormValues) => {
    try {
      await save(values, editingId)
      goBack()
    } catch {
      /* mutation surfaces its own error toast */
    }
  }

  const content = form.watch('content')

  // Edit mode: data loaded but the id doesn't exist.
  if (isUpdate && !isLoading && !editing) {
    return (
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Edit Announcement')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='text-muted-foreground flex min-h-40 flex-col items-center justify-center gap-3 text-sm'>
            {t('Announcement not found')}
            <Button variant='outline' size='sm' onClick={goBack}>
              {t('Back')}
            </Button>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {isUpdate ? t('Edit Announcement') : t('Add Announcement')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' onClick={goBack}>
            {t('Cancel')}
          </Button>
          <Button
            form='announcement-form'
            type='submit'
            size='sm'
            disabled={isPending || (isUpdate && !ready)}
          >
            {isPending ? t('Saving...') : t('Save changes')}
          </Button>
        </div>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {isUpdate && !ready ? (
          <Skeleton className='h-96 w-full rounded-2xl' />
        ) : (
          <Form {...form}>
            <form
              id='announcement-form'
              onSubmit={form.handleSubmit(onSubmit)}
              className='flex flex-col gap-5'
            >
              {/* Meta */}
              <div className='bg-card flex flex-col gap-4 rounded-2xl border p-4 sm:p-5'>
                <FormField
                  control={form.control}
                  name='title'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('Title')}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t('Enter announcement title')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='category'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Category')}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={t('e.g. Notice, Maintenance, Update')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t('Optional free-text tag (max 20 characters).')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='publishDate'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Publish Date')}</FormLabel>
                        <FormControl>
                          <DateTimePicker
                            value={
                              field.value ? new Date(field.value) : undefined
                            }
                            onChange={(date) =>
                              field.onChange(date ? date.toISOString() : '')
                            }
                            placeholder={t('Select publish date')}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'A future time schedules the announcement to appear automatically.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className='grid gap-4 sm:grid-cols-2'>
                  <FormField
                    control={form.control}
                    name='status'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Status')}</FormLabel>
                        <Select
                          items={[
                            { value: 'draft', label: t('Draft') },
                            { value: 'published', label: t('Published') },
                          ]}
                          onValueChange={field.onChange}
                          value={field.value}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t('Select status')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent alignItemWithTrigger={false}>
                            <SelectGroup>
                              <SelectItem value='draft'>{t('Draft')}</SelectItem>
                              <SelectItem value='published'>
                                {t('Published')}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name='pinned'
                    render={({ field }) => (
                      <FormItem className='flex items-center justify-between rounded-lg border px-3 py-2'>
                        <div className='space-y-0.5'>
                          <FormLabel>{t('Pin to top')}</FormLabel>
                          <FormDescription>
                            {t('Pinned announcements are shown first.')}
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Content: left editor / right live preview */}
              <FormField
                control={form.control}
                name='content'
                render={({ field }) => (
                  <FormItem className='gap-3'>
                    <div className='flex items-center justify-between'>
                      <FormLabel>{t('Content')}</FormLabel>
                      <FormDescription>
                        {t(
                          'Maximum 2000 characters. Supports Markdown and HTML.'
                        )}
                      </FormDescription>
                    </div>
                    <div className='grid gap-4 lg:grid-cols-2'>
                      <div className='flex flex-col gap-1.5'>
                        <span className='text-muted-foreground text-xs font-medium'>
                          {t('Edit')}
                        </span>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder={t(
                              'Enter announcement content (supports Markdown/HTML)'
                            )}
                            className='min-h-[55vh] resize-y font-normal'
                          />
                        </FormControl>
                        <FormMessage />
                      </div>
                      <div className='flex flex-col gap-1.5'>
                        <span className='text-muted-foreground text-xs font-medium'>
                          {t('Preview')}
                        </span>
                        <div className='bg-card min-h-[55vh] overflow-auto rounded-lg border px-4 py-3'>
                          {content.trim() ? (
                            <Markdown>{content}</Markdown>
                          ) : (
                            <p className='text-muted-foreground text-sm'>
                              {t('Nothing to preview')}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </FormItem>
                )}
              />
            </form>
          </Form>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
