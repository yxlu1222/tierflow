/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * TierFlow 品牌落地页 —— 按参考稿 index(4).html 的排版重写。
 * 干净的中性白底 SaaS 风格,蓝色强调色,Schibsted Grotesk / Inter 字体
 * (@fontsource,作用域隔离于 `.tf-landing`,仅亮色)。等宽字体按项目约定
 * 不引入,--tf-mono 指向正文字体。
 * 头部/页脚沿用 App 的 PublicHeader / Footer(由 Home 提供),本组件只渲染
 * 中间落地内容。CTA 接入应用路由,文档指向外部 Doc 站。
 */
import { useEffect, useId, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { codeToHtml, type ShikiTransformer } from 'shiki/bundle/web'
import { useAuthStore } from '@/stores/auth-store'
import { AnimateInView } from '@/components/animate-in-view'
import {
  ArrowIcon,
  CONTAINER,
  DISPLAY,
  DOCS_URL,
  Eyebrow,
  GhostLink,
  PrimaryButton,
} from '@/components/landing-kit'
import {
  BASELINE,
  COST_EFFICIENCY,
  COST_FRACTION,
  TIERFLOW,
} from './bench-data'
import { HowSection } from './how-section'
import { ProblemSection } from './problem-section'
import { ProofSection } from './proof-section'

// Hero 数据指标 —— 全部由 bench-data 的实测行派生,不再单独写死
const proof = [
  { val: `${TIERFLOW.score}%`, label: 'PinchBench 完成率', accent: false },
  { val: `¥${TIERFLOW.cost}`, label: '平均任务成本', accent: true },
  {
    val: `${COST_EFFICIENCY}x`,
    label: `成本效率 vs ${BASELINE.short}`,
    accent: true,
  },
]

// Hero 强调蓝 —— 跟随 .tf-landing 的 --tf-pos 品牌强调色(蓝,亮/暗自动切换)
const TF_BLUE = 'var(--tf-pos)'

function BrandMark(props: { className?: string }) {
  // 与 header 的 /tierflow-logo.svg 保持一致的蓝色渐变(#4A3AF8 → #256BFB)
  const gid = useId()
  return (
    <svg
      viewBox='0 0 96 74'
      fill={`url(#${gid})`}
      aria-hidden='true'
      className={props.className}
    >
      <defs>
        <linearGradient id={gid} x1='0%' y1='0%' x2='100%' y2='0%'>
          <stop offset='0%' stopColor='#4A3AF8' />
          <stop offset='100%' stopColor='#256BFB' />
        </linearGradient>
      </defs>
      <circle cx='9' cy='9' r='9' />
      <rect x='30' y='0' width='66' height='18' rx='9' />
      <rect x='0' y='28' width='96' height='18' rx='9' />
      <circle cx='9' cy='65' r='9' />
      <rect x='30' y='56' width='40' height='18' rx='9' />
      <circle cx='87' cy='65' r='9' />
    </svg>
  )
}

export function TierFlowLanding(props: { isAuthenticated?: boolean }) {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const isLoggedIn = props.isAuthenticated ?? !!auth.user

  const baseUrl =
    (typeof window !== 'undefined' ? window.location.origin : '') + '/v1'

  const handleCtaClick = () => {
    navigate({ to: isLoggedIn ? '/usage' : '/sign-up' })
  }

  return (
    <div className='tf-landing relative overflow-x-clip'>
      <HeroSection onCta={handleCtaClick} />
      <ProblemSection />
      <HowSection />
      <ProofSection />
      <DeveloperSection baseUrl={baseUrl} />
      <FinalCta onCta={handleCtaClick} />
    </div>
  )
}

/* ===================== HERO ===================== */
const HERO_GHOST =
  'inline-flex h-[50px] items-center justify-center gap-2 rounded-[11px] border border-[var(--tf-line-2)] bg-[var(--tf-surface)] px-[26px] text-[15.5px] font-medium whitespace-nowrap text-[var(--tf-ink)] transition-colors duration-200 hover:border-[var(--tf-ink)]'

function HeroSection(props: { onCta: () => void }) {
  return (
    // 首屏整段占满一屏并垂直居中。头部是 fixed 的(h-20 = 80px),会盖在这一段
    // 上面,所以顶部内边距 = 头部高度 + 参考稿的 80px,让标志到头部下沿的间距
    // 与参考稿一致;底部沿用参考稿的 60px。
    <section
      className='relative flex items-center overflow-hidden pt-[calc(80px_+_clamp(40px,7vw,80px))] pb-[clamp(48px,6vw,60px)] lg:min-h-svh'
      style={{
        background:
          'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(37,107,251,0.06), transparent 70%)',
      }}
    >
      <AnimateInView animation='fade-up' className='w-full'>
        <div className={`${CONTAINER} flex flex-col items-center text-center`}>
          {/* logo + wordmark */}
          <div className='flex items-center justify-center gap-[clamp(10px,1.4vw,16px)]'>
            <BrandMark className='h-[clamp(24px,2.6vw,34px)] w-auto' />
            <span
              className='text-[clamp(28px,3.4vw,44px)] leading-none font-semibold tracking-[-0.03em] text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              TierFlow
            </span>
          </div>

          {/* headline —— 参考稿的主标语是不折行的一整行,字号随视口缩放;
              只有最窄的屏幕(clamp 触底 28px)才允许回落成两行 */}
          <h1
            className='m-0 mt-[22px] text-[clamp(28px,5.6vw,80px)] leading-[1.04] font-semibold tracking-[-0.04em] text-[var(--tf-ink)] sm:whitespace-nowrap'
            style={DISPLAY}
          >
            更便宜，更快速，
            <span style={{ color: TF_BLUE }}>也更强。</span>
          </h1>

          <p
            className='m-0 mt-[18px] max-w-[720px] text-[clamp(19px,2.2vw,28px)] leading-[1.3] font-medium tracking-[-0.02em] text-balance text-[var(--tf-ink-2)]'
            style={DISPLAY}
          >
            在智能体执行过程中动态调度模型、优化上下文与记忆
          </p>

          {/* paragraph */}
          <p className='m-0 mt-[clamp(20px,2.2vw,28px)] max-w-[660px] text-[clamp(16px,1.35vw,18.5px)] leading-[1.72] text-pretty text-[var(--tf-muted)]'>
            面向智能体时代的推理结构感知算力调度平台。一个 API,
            <span className='font-medium' style={{ color: TF_BLUE }}>
              让每一步推理自动完成任务分析、模型择优与成本控制
            </span>
            ——推理成本降至{' '}
            <b className='font-semibold text-[var(--tf-ink-2)]'>
              1/{COST_FRACTION}
            </b>
            ，完成率
            <b className='font-semibold text-[var(--tf-ink-2)]'>
              反超 {BASELINE.short}
            </b>
            。
          </p>

          {/* CTA */}
          <div className='mt-[clamp(28px,3.4vw,40px)] flex flex-wrap justify-center gap-3'>
            <PrimaryButton size='lg' onClick={props.onCta}>
              获取 API Key
            </PrimaryButton>
            <a href='#proof' className={HERO_GHOST}>
              实测数据
            </a>
          </div>

          {/* proof stats */}
          <div className='mx-auto mt-[clamp(40px,5vw,60px)] w-full max-w-[760px] border-t border-[var(--tf-line)] pt-[clamp(28px,3.4vw,40px)]'>
            <div className='flex flex-wrap items-stretch justify-center'>
              {proof.map((p, i) => (
                <div
                  key={p.label}
                  className={`px-[clamp(14px,2.4vw,32px)] ${i > 0 ? 'border-l border-[var(--tf-line)]' : ''}`}
                >
                  <div
                    className='text-[clamp(24px,2.8vw,32px)] leading-none font-semibold tracking-[-0.02em] tabular-nums'
                    style={{
                      ...DISPLAY,
                      color: p.accent ? TF_BLUE : 'var(--tf-ink)',
                    }}
                  >
                    {p.val}
                  </div>
                  <div className='mt-2 text-[13px] whitespace-nowrap text-[var(--tf-faint)]'>
                    {p.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AnimateInView>
    </section>
  )
}

/* ===================== 开发者接入 (04) ===================== */
// 样式与文案对齐 index(4).html 参考版:两步接入标题、等分双栏居中、
// 步骤为纯文字,代码卡为浅色(无行号/语言徽章,左蓝条高亮)
function DeveloperSection(props: { baseUrl: string }) {
  const steps = [
    '把 baseURL 换成 TierFlow 接入点',
    '把 model 设为对应 agent 工具的模式（如 codex）',
    '照常发起请求，调度引擎内部自动决策最优模型与最低成本',
  ]
  return (
    <section
      id='developers'
      className='scroll-mt-[88px] py-[clamp(48px,6vw,80px)]'
    >
      {/* 眉标独立在 grid 之外：代码卡顶部与「两步接入」标题对齐,而非与眉标对齐 */}
      <div className={CONTAINER}>
        <AnimateInView animation='fade-up'>
          <Eyebrow index='04' label='开发者接入' />
        </AnimateInView>
        {/* items-stretch：代码卡上下沿与左栏(标题起)顶/底对齐,避免自然高度居中显小 */}
        <div className='mt-4 grid grid-cols-1 items-stretch gap-[clamp(32px,5vw,56px)] lg:grid-cols-2'>
          <AnimateInView animation='fade-up'>
            <div>
              <h2
                className='m-0 text-[clamp(28px,3.6vw,42px)] leading-[1.12] font-semibold tracking-[-0.025em] text-[var(--tf-ink)]'
                style={DISPLAY}
              >
                两步接入，
                <br />
                调度引擎即刻接管
              </h2>
              <p className='m-0 mt-5 text-[15px] leading-[1.7] text-[var(--tf-muted)]'>
                保持 OpenAI SDK 原有方式，把{' '}
                <code className={CODE_INLINE}>baseURL</code> 指向
                TierFlow，模型名设为所用 agent 对应的模式（如在 Codex 中使用即填{' '}
                <code className={CODE_INLINE}>codex</code>
                ）。调度引擎在内部自动完成任务分析、模型匹配、重试与成本控制——你的
                Agent 无需改变，调度层在背后运行。
              </p>
              <ul className='m-0 mt-8 flex list-none flex-col gap-5 p-0'>
                {steps.map((s, i) => (
                  <li
                    key={s}
                    className='flex items-start gap-4 text-[15px] leading-[1.6] text-[var(--tf-ink-2)]'
                  >
                    <span className='grid size-8 shrink-0 place-items-center rounded-full bg-[var(--tf-pos)] text-[14px] font-semibold text-white tabular-nums'>
                      {i + 1}
                    </span>
                    <span className='pt-1'>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AnimateInView>

          <AnimateInView animation='fade-up' delay={140} className='h-full'>
            <CodeCard baseUrl={props.baseUrl} />
          </AnimateInView>
        </div>
      </div>
    </section>
  )
}

const CODE_INLINE =
  'tf-mono rounded-[5px] bg-[var(--tf-surface-3)] px-[7px] py-0.5 text-[14px] text-[var(--tf-ink)]'

// 代码卡改用项目现成的 shiki 高亮(与 ai-elements/code-block 同源,
// one-light 主题),替代原先手搓的 token 上色。高亮行(baseURL / model)
// 由 transformer 打上 tf-hl 类,样式在下方容器的 arbitrary variants 里。
const HL_LINES = [4, 9]

const tfCodeTransformer: ShikiTransformer = {
  name: 'tf-landing-hl',
  line(node, line) {
    if (HL_LINES.includes(line)) {
      this.addClassToHast(node, 'tf-hl')
    }
  },
  code(node) {
    // 去掉行间的 \n 文本节点:.line 会以 block 显示,保留 \n 会双倍行距
    node.children = node.children.filter(
      (c) => !(c.type === 'text' && c.value === '\n')
    )
  },
}

function CodeCard(props: { baseUrl: string }) {
  // 语句块之间留空行,让代码框更饱满(空行行号计入 HL_LINES)
  const code = `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: '${props.baseUrl}',
  apiKey: process.env.TIERFLOW_API_KEY,
});

const res = await client.chat.completions.create({
  model: 'codex',  // 对应 agent 工具，内部自动择优
  messages: [{ role: 'user', content: 'Run this browser task...' }],
});`

  const [html, setHtml] = useState('')
  useEffect(() => {
    let cancelled = false
    codeToHtml(code, {
      lang: 'typescript',
      theme: 'one-light',
      transformers: [tfCodeTransformer],
    }).then((next) => {
      if (!cancelled) setHtml(next)
    })
    return () => {
      cancelled = true
    }
  }, [code])

  // shiki 输出的 <pre>:去掉自带底色,套用卡片排版(14.5px/1.8,水平 22px);
  // 高亮行整行铺底 + 左侧 2px 蓝条,负 margin 吃掉 pre 的水平 padding;
  // 不加任何上下 margin/padding,行高与普通行(即鼠标选中高度)完全一致
  const shikiClasses = [
    '[&>pre]:m-0 [&>pre]:bg-transparent! [&>pre]:px-[22px] [&>pre]:py-5',
    '[&>pre]:text-[14.5px] [&>pre]:leading-[1.8]',
    '[&_code]:block [&_code]:min-w-max',
    // min-h 撑起空行(shiki 的空行是无内容的 span,block 化后会塌成 0 高)
    '[&_.line]:block [&_.line]:min-h-[1.8em] [&_.line]:whitespace-pre',
    '[&_.tf-hl]:-mx-[22px] [&_.tf-hl]:border-l-2',
    '[&_.tf-hl]:border-[var(--tf-pos)] [&_.tf-hl]:bg-[var(--tf-pos-soft)]',
    '[&_.tf-hl]:pr-[22px] [&_.tf-hl]:pl-[20px]',
  ].join(' ')

  return (
    <div
      className='flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--tf-line)] bg-[#FAFBFC]'
      aria-label='接入示例'
    >
      {/* code-bar:三个灰点 + 文件名(参考版无语言徽章) */}
      <div className='flex items-center gap-2.5 border-b border-[var(--tf-line)] px-[18px] py-3.5'>
        {/* macOS 红黄绿窗口按钮配色 */}
        <span className='flex gap-1.5' aria-hidden='true'>
          <span className='h-2 w-2 rounded-full bg-[#FF5F57]' />
          <span className='h-2 w-2 rounded-full bg-[#FEBC2E]' />
          <span className='h-2 w-2 rounded-full bg-[#28C840]' />
        </span>
        {/* 文件名字号与代码正文一致(14.5px) */}
        <span className='tf-mono text-[14.5px] text-[var(--tf-faint)]'>
          tierflow-quickstart.ts
        </span>
      </div>

      {/* flex-1 + content-center：卡片拉伸到与左栏等高,代码在余量里垂直居中 */}
      {html ? (
        <div
          className={`flex-1 content-center overflow-x-auto ${shikiClasses}`}
          // shiki 本地生成的可信 HTML
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // shiki 异步高亮完成前的占位:同排版纯文本,避免布局跳动
        <pre className='m-0 flex-1 content-center overflow-x-auto px-[22px] py-5 text-[14.5px] leading-[1.8] whitespace-pre text-[var(--tf-ink-2)]'>
          {code}
        </pre>
      )}
    </div>
  )
}

/* ===================== 收束 CTA ===================== */
function FinalCta(props: { onCta: () => void }) {
  return (
    // 一体机版本不展示套餐横条，使用简洁白底收束页面。
    <section>
      <div className={`${CONTAINER} py-[clamp(48px,6vw,80px)] text-center`}>
        <AnimateInView animation='fade-up'>
          <h2
            className='m-0 text-[clamp(30px,4vw,50px)] leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
            style={DISPLAY}
          >
            让 TierFlow 接管下一次推理决策
          </h2>
          <p className='mx-auto mt-[22px] text-[17px] leading-[1.6] text-[var(--tf-muted)]'>
            在生产智能体中接入
            TierFlow，为你的应用降低成本、提升完成率、保障稳定。
          </p>
          <div className='mt-[34px] inline-flex flex-wrap justify-center gap-3'>
            <PrimaryButton size='lg' onClick={props.onCta}>
              免费开始 <ArrowIcon />
            </PrimaryButton>
            <GhostLink size='lg' href={DOCS_URL}>
              查看接入文档
            </GhostLink>
          </div>
        </AnimateInView>
      </div>
    </section>
  )
}
