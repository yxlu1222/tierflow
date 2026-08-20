/*
Copyright (C) 2023-2026 TierFlow
*/
import { useMemo, useState } from 'react'
import {
  BarChart3,
  BookOpenText,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  FileArchive,
  FileSearch,
  FileUp,
  LibraryBig,
  LockKeyhole,
  Pencil,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  UploadCloud,
  UsersRound,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useIsAdmin } from '@/hooks/use-admin'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SectionPageLayout } from '@/components/layout'

type SkillTab = 'mine' | 'marketplace'
type SkillSource = 'Official' | 'Team shared'
type SkillCategory =
  | 'All'
  | 'Knowledge retrieval'
  | 'Data analysis'
  | 'Content creation'
  | 'Office efficiency'
  | 'Developer tools'

type SkillDefinition = {
  id: string
  name: string
  description: string
  category: Exclude<SkillCategory, 'All'>
  source: SkillSource
  owner: string
  version: string
  downloads: string
  rating: string
  icon: React.ElementType
  tone: string
}

type InstalledSkill = SkillDefinition & {
  enabled: boolean
  calls: number
  updatedAt: string
}

const marketplaceSkills: SkillDefinition[] = [
  {
    id: 'knowledge-base',
    name: 'Enterprise knowledge Q&A',
    description:
      'Connect internal documents and provide trustworthy knowledge retrieval and answers for the team.',
    category: 'Knowledge retrieval',
    source: 'Official',
    owner: 'TierFlow',
    version: 'v1.4.2',
    downloads: '2.1k',
    rating: '4.8',
    icon: BookOpenText,
    tone: 'from-blue-500 to-indigo-500',
  },
  {
    id: 'report-analysis',
    name: 'Data report analysis',
    description:
      'Parse tables and indicators to quickly generate visual analysis conclusions.',
    category: 'Data analysis',
    source: 'Official',
    owner: 'TierFlow',
    version: 'v2.1.0',
    downloads: '1.6k',
    rating: '4.7',
    icon: BarChart3,
    tone: 'from-emerald-400 to-teal-500',
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes assistant',
    description:
      'Summarize meetings and organize decisions, action items, and follow-up owners.',
    category: 'Office efficiency',
    source: 'Team shared',
    owner: 'Solution team',
    version: 'v1.8.3',
    downloads: '1.2k',
    rating: '4.6',
    icon: UsersRound,
    tone: 'from-violet-500 to-purple-500',
  },
  {
    id: 'code-review',
    name: 'Code review assistant',
    description:
      'Review code quality and potential risks, and provide actionable improvement suggestions.',
    category: 'Developer tools',
    source: 'Team shared',
    owner: 'Platform team',
    version: 'v1.3.1',
    downloads: '980',
    rating: '4.5',
    icon: Code2,
    tone: 'from-orange-400 to-amber-500',
  },
  {
    id: 'contract-extraction',
    name: 'Contract key point extraction',
    description:
      'Extract important clauses, responsibilities, dates, and risk points from contracts.',
    category: 'Knowledge retrieval',
    source: 'Team shared',
    owner: 'Business team',
    version: 'v1.2.6',
    downloads: '870',
    rating: '4.6',
    icon: FileSearch,
    tone: 'from-cyan-500 to-blue-500',
  },
  {
    id: 'marketing-copy',
    name: 'Marketing content generation',
    description:
      'Generate structured marketing copy for different audiences, channels, and campaign goals.',
    category: 'Content creation',
    source: 'Official',
    owner: 'TierFlow',
    version: 'v1.6.0',
    downloads: '1.1k',
    rating: '4.4',
    icon: PenLine,
    tone: 'from-fuchsia-500 to-pink-500',
  },
]

const installedSkills: InstalledSkill[] = [
  {
    ...marketplaceSkills[0],
    enabled: true,
    calls: 86,
    updatedAt: '2026-08-12',
  },
  {
    ...marketplaceSkills[2],
    enabled: true,
    calls: 31,
    updatedAt: '2026-08-10',
  },
  {
    ...marketplaceSkills[3],
    enabled: false,
    calls: 11,
    updatedAt: '2026-08-08',
  },
]

const categories: SkillCategory[] = [
  'All',
  'Knowledge retrieval',
  'Data analysis',
  'Content creation',
  'Office efficiency',
  'Developer tools',
]

const sourceFilters: Array<'All sources' | SkillSource> = [
  'All sources',
  'Official',
  'Team shared',
]

export function SkillMarketplace() {
  const { t } = useTranslation()
  const isAdmin = useIsAdmin()
  const [activeTab, setActiveTab] = useState<SkillTab>('mine')
  const [category, setCategory] = useState<SkillCategory>('All')
  const [source, setSource] = useState<'All sources' | SkillSource>(
    'All sources'
  )
  const [keyword, setKeyword] = useState('')
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(
    null
  )
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | null>(null)

  const filteredSkills = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return marketplaceSkills.filter((skill) => {
      const matchesCategory = category === 'All' || skill.category === category
      const matchesSource = source === 'All sources' || skill.source === source
      const matchesKeyword =
        query.length === 0 ||
        t(skill.name).toLowerCase().includes(query) ||
        t(skill.description).toLowerCase().includes(query) ||
        t(skill.owner).toLowerCase().includes(query)
      return matchesCategory && matchesSource && matchesKeyword
    })
  }, [category, keyword, source, t])

  const handleDownload = (skill: SkillDefinition) => {
    toast.info(
      t(
        'The Skill package download will be enabled after storage is connected.'
      ),
      { description: `${t(skill.name)} · ${skill.version}` }
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Skill Center')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='pill'
            onClick={() => setUploadOpen(true)}
          >
            {activeTab === 'mine' ? (
              <FileUp className='size-4' />
            ) : (
              <UploadCloud className='size-4' />
            )}
            {activeTab === 'mine'
              ? t('Import local Skill')
              : t('Upload team Skill')}
          </Button>
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as SkillTab)}
            className='space-y-5'
          >
            <div className='flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between'>
              <TabsList className='h-12 w-full rounded-xl bg-slate-100 p-1 sm:w-auto'>
                <TabsTrigger
                  value='mine'
                  className='h-10 min-w-36 gap-2 rounded-lg px-5 text-base'
                >
                  <LibraryBig className='size-4' />
                  {t('My Skills')}
                </TabsTrigger>
                <TabsTrigger
                  value='marketplace'
                  className='h-10 min-w-36 gap-2 rounded-lg px-5 text-base'
                >
                  <Store className='size-4' />
                  {t('Skill Marketplace')}
                </TabsTrigger>
              </TabsList>
              <div className='flex items-center gap-2 text-sm text-slate-500'>
                <ShieldCheck className='size-4 text-blue-600' />
                {isAdmin
                  ? t('Administrators can maintain team shared Skills.')
                  : t(
                      'You can upload, view, and download team Skills. Editing is restricted.'
                    )}
              </div>
            </div>

            <TabsContent value='mine' className='space-y-5'>
              <MySkillsPanel
                skills={installedSkills}
                onView={setSelectedSkill}
              />
            </TabsContent>

            <TabsContent value='marketplace' className='space-y-5'>
              <MarketplacePanel
                category={category}
                filteredSkills={filteredSkills}
                isAdmin={isAdmin}
                keyword={keyword}
                source={source}
                onCategoryChange={setCategory}
                onDownload={handleDownload}
                onEdit={setEditingSkill}
                onKeywordChange={setKeyword}
                onSourceChange={setSource}
                onUpload={() => setUploadOpen(true)}
                onView={setSelectedSkill}
              />
            </TabsContent>
          </Tabs>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <SkillDetailSheet
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
        onDownload={handleDownload}
      />
      <UploadSkillSheet open={uploadOpen} onOpenChange={setUploadOpen} />
      <EditSkillSheet
        skill={isAdmin ? editingSkill : null}
        onClose={() => setEditingSkill(null)}
      />
    </>
  )
}

function MySkillsPanel({
  skills,
  onView,
}: {
  skills: InstalledSkill[]
  onView: (skill: SkillDefinition) => void
}) {
  const { t } = useTranslation()
  const enabledCount = skills.filter((skill) => skill.enabled).length
  const totalCalls = skills.reduce((sum, skill) => sum + skill.calls, 0)

  return (
    <>
      <div className='grid gap-4 md:grid-cols-3'>
        {[
          {
            label: t('Installed Skills'),
            value: skills.length,
            detail: t('Skills available to this account'),
            icon: LibraryBig,
          },
          {
            label: t('Enabled Skills'),
            value: enabledCount,
            detail: t('Currently available through the API'),
            icon: CheckCircle2,
          },
          {
            label: t('Skill calls'),
            value: totalCalls,
            detail: t('Calls accumulated by this account'),
            icon: Sparkles,
          },
        ].map((item) => (
          <Card key={item.label} className='rounded-2xl border-slate-200 py-0'>
            <CardContent className='flex items-center gap-4 p-5'>
              <span className='flex size-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600'>
                <item.icon className='size-5' />
              </span>
              <div>
                <p className='text-sm text-slate-500'>{item.label}</p>
                <p className='mt-1 text-2xl font-semibold text-slate-950'>
                  {item.value}
                </p>
                <p className='mt-0.5 text-sm text-slate-400'>{item.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className='rounded-2xl border-slate-200 py-0'>
        <CardContent className='p-0'>
          <div className='border-b border-slate-100 px-5 py-4'>
            <h2 className='text-lg font-semibold text-slate-950'>
              {t('My installed Skills')}
            </h2>
            <p className='mt-1 text-sm text-slate-500'>
              {t(
                'View Skills imported or assigned to the current account. Editing is not exposed here.'
              )}
            </p>
          </div>
          <div className='divide-y divide-slate-100'>
            {skills.map((skill) => {
              const Icon = skill.icon
              return (
                <div
                  key={skill.id}
                  className='flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center'
                >
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ${skill.tone}`}
                  >
                    <Icon className='size-5' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='text-base font-semibold text-slate-950'>
                        {t(skill.name)}
                      </h3>
                      <Badge
                        className={
                          skill.enabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }
                      >
                        {skill.enabled ? t('Enabled') : t('Disabled')}
                      </Badge>
                      <Badge variant='outline'>{t(skill.source)}</Badge>
                    </div>
                    <p className='mt-1 line-clamp-1 text-sm text-slate-500'>
                      {t(skill.description)}
                    </p>
                  </div>
                  <div className='grid grid-cols-3 gap-5 text-sm lg:w-[320px]'>
                    <SkillMeta label={t('Version')} value={skill.version} />
                    <SkillMeta label={t('Calls')} value={String(skill.calls)} />
                    <SkillMeta label={t('Updated')} value={skill.updatedAt} />
                  </div>
                  <Button
                    variant='outline'
                    className='rounded-xl'
                    onClick={() => onView(skill)}
                  >
                    <Eye className='size-4' />
                    {t('View details')}
                  </Button>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function MarketplacePanel({
  category,
  filteredSkills,
  isAdmin,
  keyword,
  source,
  onCategoryChange,
  onDownload,
  onEdit,
  onKeywordChange,
  onSourceChange,
  onUpload,
  onView,
}: {
  category: SkillCategory
  filteredSkills: SkillDefinition[]
  isAdmin: boolean
  keyword: string
  source: 'All sources' | SkillSource
  onCategoryChange: (category: SkillCategory) => void
  onDownload: (skill: SkillDefinition) => void
  onEdit: (skill: SkillDefinition) => void
  onKeywordChange: (value: string) => void
  onSourceChange: (source: 'All sources' | SkillSource) => void
  onUpload: () => void
  onView: (skill: SkillDefinition) => void
}) {
  const { t } = useTranslation()
  const teamCount = marketplaceSkills.filter(
    (skill) => skill.source === 'Team shared'
  ).length

  return (
    <>
      <Card className='overflow-hidden rounded-2xl border-blue-100 bg-[linear-gradient(120deg,#f6f9ff_0%,#eef3ff_55%,#f8f5ff_100%)] py-0'>
        <CardContent className='grid gap-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center'>
          <div className='flex items-start gap-4'>
            <span className='flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm'>
              <UsersRound className='size-5.5' />
            </span>
            <div>
              <div className='flex flex-wrap items-center gap-2'>
                <h2 className='text-xl font-semibold text-slate-950'>
                  {t('Team shared Skills')}
                </h2>
                <Badge className='bg-white text-blue-700'>
                  {t('{{count}} available', { count: teamCount })}
                </Badge>
              </div>
              <p className='mt-1.5 text-base text-slate-500'>
                {t(
                  'Members can upload, view, and download reviewed team Skills. Only administrators can edit shared entries.'
                )}
              </p>
            </div>
          </div>
          <Button className='rounded-full' onClick={onUpload}>
            <UploadCloud className='size-4' />
            {t('Upload team Skill')}
          </Button>
        </CardContent>
      </Card>

      <div className='flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between'>
        <div className='flex flex-wrap gap-2'>
          {sourceFilters.map((item) => (
            <Button
              key={item}
              type='button'
              variant={source === item ? 'default' : 'outline'}
              className='rounded-full px-4 text-sm'
              onClick={() => onSourceChange(item)}
            >
              {t(item)}
            </Button>
          ))}
          <span className='mx-1 hidden h-9 w-px bg-slate-200 sm:block' />
          {categories.map((item) => (
            <Button
              key={item}
              type='button'
              variant={category === item ? 'secondary' : 'ghost'}
              className='rounded-full px-4 text-sm'
              onClick={() => onCategoryChange(item)}
            >
              {t(item)}
            </Button>
          ))}
        </div>
        <div className='relative w-full xl:w-[320px]'>
          <Search className='pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400' />
          <Input
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder={t('Search Skills')}
            className='h-11 rounded-xl bg-white pl-10 text-base'
          />
        </div>
      </div>

      <div className='grid gap-4 md:grid-cols-2 2xl:grid-cols-3'>
        {filteredSkills.map((skill) => {
          const Icon = skill.icon
          const editable = isAdmin && skill.source === 'Team shared'
          return (
            <Card
              key={skill.id}
              className='gap-0 rounded-2xl border-slate-200/80 py-0 shadow-[0_10px_34px_rgba(15,23,42,0.04)] transition-transform hover:-translate-y-0.5'
            >
              <CardContent className='flex min-h-[306px] flex-col p-5'>
                <div className='flex items-start gap-4'>
                  <span
                    className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md ${skill.tone}`}
                  >
                    <Icon className='size-5.5' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <h3 className='text-lg font-semibold text-slate-950'>
                        {t(skill.name)}
                      </h3>
                      <Badge
                        className={
                          skill.source === 'Official'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-violet-50 text-violet-700'
                        }
                      >
                        {t(skill.source)}
                      </Badge>
                    </div>
                    <p className='mt-1 text-sm text-slate-400'>
                      {t('Shared by {{owner}}', { owner: t(skill.owner) })}
                    </p>
                  </div>
                  {editable && (
                    <Button
                      size='icon'
                      variant='ghost'
                      aria-label={t('Edit team Skill')}
                      onClick={() => onEdit(skill)}
                    >
                      <Pencil className='size-4' />
                    </Button>
                  )}
                </div>
                <Badge variant='outline' className='mt-3 w-fit'>
                  {t(skill.category)}
                </Badge>
                <p className='mt-4 flex-1 text-base leading-7 text-slate-500'>
                  {t(skill.description)}
                </p>
                <div className='mt-4 flex items-center justify-between text-sm text-slate-500'>
                  <span>{skill.version}</span>
                  <span>
                    ★ {skill.rating} · {skill.downloads} {t('downloads')}
                  </span>
                </div>
                <div className='mt-4 grid grid-cols-2 gap-2'>
                  <Button
                    variant='outline'
                    className='h-11 rounded-xl'
                    onClick={() => onView(skill)}
                  >
                    <Eye className='size-4' />
                    {t('View')}
                  </Button>
                  <Button
                    className='h-11 rounded-xl'
                    onClick={() => onDownload(skill)}
                  >
                    <Download className='size-4' />
                    {t('Download')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredSkills.length === 0 && (
        <Card>
          <CardContent className='flex flex-col items-center py-14 text-center'>
            <Search className='size-9 text-slate-300' />
            <h3 className='mt-4 text-xl font-semibold text-slate-900'>
              {t('No matching Skills')}
            </h3>
            <p className='mt-2 text-base text-slate-500'>
              {t('Try another keyword or category.')}
            </p>
          </CardContent>
        </Card>
      )}
    </>
  )
}

function SkillMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className='text-xs text-slate-400'>{label}</p>
      <p className='mt-1 font-medium text-slate-700'>{value}</p>
    </div>
  )
}

function SkillDetailSheet({
  skill,
  onClose,
  onDownload,
}: {
  skill: SkillDefinition | null
  onClose: () => void
  onDownload: (skill: SkillDefinition) => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet open={skill != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='sm:max-w-[460px]'>
        <SheetHeader>
          <SheetTitle>{t('Skill details')}</SheetTitle>
          <SheetDescription>
            {t('Review the Skill source, version, and access information.')}
          </SheetDescription>
        </SheetHeader>
        {skill && (
          <div className='space-y-5 overflow-auto px-4 py-5'>
            <div className='flex items-start gap-4 rounded-2xl border bg-slate-50/70 p-4'>
              <span
                className={`flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white ${skill.tone}`}
              >
                <skill.icon className='size-5.5' />
              </span>
              <div>
                <h3 className='text-lg font-semibold text-slate-950'>
                  {t(skill.name)}
                </h3>
                <p className='mt-1 text-sm text-slate-500'>
                  {skill.version} · {t(skill.source)} · {t(skill.owner)}
                </p>
              </div>
            </div>
            <p className='text-base leading-7 text-slate-600'>
              {t(skill.description)}
            </p>
            {[
              {
                icon: Bot,
                title: t('Model service'),
                detail: t('Use the default text model service'),
              },
              {
                icon: LockKeyhole,
                title: t('Access permission'),
                detail: t('Available to members of this appliance'),
              },
              {
                icon: BriefcaseBusiness,
                title: t('Publisher'),
                detail: t(skill.owner),
              },
            ].map((item) => (
              <div
                key={item.title}
                className='flex items-center gap-3 rounded-xl border p-4'
              >
                <item.icon className='size-5 text-blue-600' />
                <div>
                  <p className='text-base font-medium text-slate-900'>
                    {item.title}
                  </p>
                  <p className='mt-1 text-sm text-slate-500'>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Close')}
          </Button>
          {skill && (
            <Button onClick={() => onDownload(skill)}>
              <Download className='size-4' />
              {t('Download Skill')}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function UploadSkillSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='sm:max-w-[460px]'>
        <SheetHeader>
          <SheetTitle>{t('Upload team Skill')}</SheetTitle>
          <SheetDescription>
            {t(
              'Members can upload a Skill package for team review. Editing shared entries is reserved for administrators.'
            )}
          </SheetDescription>
        </SheetHeader>
        <div className='space-y-5 overflow-auto px-4 py-5'>
          <div className='rounded-2xl border border-dashed border-blue-200 bg-blue-50/50 p-8 text-center'>
            <FileArchive className='mx-auto size-9 text-blue-600' />
            <p className='mt-3 text-base font-medium text-slate-900'>
              {t('Choose a Skill package')}
            </p>
            <p className='mt-1 text-sm leading-6 text-slate-500'>
              {t(
                'Supports ZIP packages containing the Skill manifest and files.'
              )}
            </p>
            <Button variant='outline' className='mt-4 rounded-xl' disabled>
              {t('Select file')}
            </Button>
          </div>
          <div className='rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800'>
            {t(
              'This is a UI preview. Package storage, security scanning, and review workflows will be connected later.'
            )}
          </div>
        </div>
        <SheetFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button disabled>{t('Upload for review')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function EditSkillSheet({
  skill,
  onClose,
}: {
  skill: SkillDefinition | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet open={skill != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className='sm:max-w-[460px]'>
        <SheetHeader>
          <SheetTitle>{t('Edit team Skill')}</SheetTitle>
          <SheetDescription>
            {t(
              'This administrator-only entry will be connected to the Skill store later.'
            )}
          </SheetDescription>
        </SheetHeader>
        {skill && (
          <div className='space-y-4 px-4 py-5'>
            <div className='rounded-xl border p-4'>
              <p className='text-sm text-slate-400'>{t('Skill')}</p>
              <p className='mt-1 text-base font-semibold text-slate-900'>
                {t(skill.name)}
              </p>
            </div>
            <div className='rounded-xl bg-violet-50 p-4 text-sm leading-6 text-violet-800'>
              {t(
                'Only administrators can modify team metadata, review status, and published versions.'
              )}
            </div>
          </div>
        )}
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button disabled>{t('Save changes')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
