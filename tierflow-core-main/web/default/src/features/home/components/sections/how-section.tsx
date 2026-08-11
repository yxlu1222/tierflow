/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 02 / 产品原理 —— 六层决策链路。
 *
 * 这一段要回答的是「凭什么它选得对」。所以左边讲决策引擎本身(BrainNet-8B、
 * 决策延迟、可追溯、可配置),右边把一次 step 路由拆成六个可读的环节 ——
 * 光说「自动选模型」是句空话,把链路摊开才构成解释。
 */
import { AnimateInView } from '@/components/animate-in-view'
import { CONTAINER, DISPLAY, DOCS_URL, Eyebrow } from '@/components/landing-kit'

const PIPELINE = [
  {
    idx: '01',
    chip: 'Intent',
    title: '任务理解',
    desc: '识别当前 step 的意图、目标约束与关键信息。',
  },
  {
    idx: '02',
    chip: 'Scope',
    title: '复杂度评估',
    desc: '判断任务难度、所需能力与预期输出质量。',
  },
  {
    idx: '03',
    chip: 'Context',
    title: '上下文与记忆优化',
    desc: '提取核心上下文，整理跨步骤记忆，减少无效 Token 消耗。',
  },
  {
    idx: '04',
    chip: 'Model',
    title: '模型能力映射',
    desc: '匹配最合适的模型能力区间。',
  },
  {
    idx: '05',
    chip: 'Cost',
    title: '成本预测',
    desc: '预估 Token 消耗、延迟与成功率。',
  },
  {
    idx: '06',
    chip: 'Route',
    title: '决策输出',
    desc: '输出最优模型与执行路径。',
  },
]

const METRICS = [
  { label: '决策延迟', value: '<100ms' },
  { label: '决策可追溯', value: '完整链路' },
  { label: '策略可配置', value: '白名单/预算上限' },
]

export function HowSection() {
  return (
    <section
      id='how'
      // 固定头部 80px,锚点跳转要留出偏移,否则标题被盖住
      className='scroll-mt-[88px] border-t border-[var(--tf-line)] py-[clamp(48px,6vw,80px)]'
    >
      <div
        className={`${CONTAINER} grid grid-cols-1 gap-[clamp(40px,6vw,88px)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]`}
      >
        {/* 左栏随右侧链路滚动而吸顶 —— 外层网格项保持 stretch(占满整行高度),
            吸顶的是它里面这层,否则容器被内容压扁,sticky 没有可移动的区间 */}
        <AnimateInView animation='fade-up'>
          <div className='lg:sticky lg:top-24'>
            <Eyebrow index='02' label='产品原理' />
            <h2
              className='m-0 mt-3.5 text-[clamp(26px,2.8vw,36px)] leading-[1.12] font-semibold tracking-[-0.025em] text-[var(--tf-ink)] lg:whitespace-nowrap'
              style={DISPLAY}
            >
              一个 API，三重优化
            </h2>
            <p
              className='m-0 mt-3.5 text-[clamp(17px,1.9vw,23px)] font-medium tracking-[-0.015em] text-[var(--tf-ink-2)]'
              style={DISPLAY}
            >
              每一步，都是一次多维度的精算决策
            </p>
            <p className='m-0 mt-4 text-[clamp(16px,1.2vw,18px)] leading-[1.7] text-pretty text-[var(--tf-muted)]'>
              TierFlow 是
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                推理结构感知的调度引擎
              </b>
              ：自研 8B 参数任务感知模型
              BrainNet-8B，将任务理解、上下文与记忆优化、 成本预测合成为一次
              step 级决策，
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                平均 100ms 内
              </b>
              完成最优模型选择。
            </p>

            <a
              href={DOCS_URL}
              target='_blank'
              rel='noreferrer'
              className='mt-7 inline-flex h-[50px] items-center justify-center gap-2 rounded-[11px] bg-[var(--tf-btn)] px-[26px] text-[15.5px] font-medium text-[var(--tf-btn-ink)] transition-[background,transform] duration-200 hover:-translate-y-px hover:bg-[var(--tf-btn-hover)]'
            >
              阅读技术文档 →
            </a>

            <div className='mt-6 flex flex-wrap gap-3'>
              {METRICS.map((m) => (
                <span
                  key={m.label}
                  className='rounded-full border border-[var(--tf-line-2)] px-3.5 py-2 text-[13px] text-[var(--tf-muted)]'
                >
                  {m.label}{' '}
                  <strong className='font-semibold text-[var(--tf-ink)]'>
                    {m.value}
                  </strong>
                </span>
              ))}
            </div>
          </div>
        </AnimateInView>

        <AnimateInView animation='fade-up' delay={90}>
          {/* 六个环节串成一条纵向链路:序号胶囊之间用一条竖线连起来,
              读起来是「一次决策的先后顺序」,而不是六张并列的卡片。 */}
          <div className='relative'>
            {PIPELINE.map((step, i) => (
              <div
                key={step.idx}
                className={`relative grid grid-cols-[42px_minmax(0,1fr)_auto] items-start gap-5 py-[18px] ${
                  i < PIPELINE.length - 1
                    ? 'border-b border-[var(--tf-line)]'
                    : ''
                }`}
              >
                {i < PIPELINE.length - 1 && (
                  <span
                    aria-hidden='true'
                    className='absolute top-[50px] -bottom-px left-[21px] w-px bg-[var(--tf-line-2)]'
                  />
                )}
                <span
                  className='relative z-[1] grid h-9 w-[42px] place-items-center rounded-full border border-[var(--tf-line-2)] bg-[var(--tf-surface)] text-[14px] font-semibold text-[var(--tf-ink)] tabular-nums'
                  style={DISPLAY}
                >
                  {step.idx}
                </span>
                <div className='min-w-0'>
                  <h3
                    className='mt-[5px] mb-1.5 text-[17px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                    style={DISPLAY}
                  >
                    {step.title}
                  </h3>
                  <p className='m-0 text-[14.5px] leading-[1.6] text-[var(--tf-muted)]'>
                    {step.desc}
                  </p>
                </div>
                <span className='self-center rounded-full border border-[var(--tf-line)] bg-[var(--tf-surface)] px-[11px] py-1 text-[12px] whitespace-nowrap text-[var(--tf-faint)]'>
                  {step.chip}
                </span>
              </div>
            ))}

            <div className='mt-4 flex items-center justify-between gap-3.5 rounded-[14px] border border-[var(--tf-pos)] bg-[var(--tf-pos-soft)] px-5 py-4'>
              <span className='min-w-0'>
                <strong
                  className='block text-[16px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                  style={DISPLAY}
                >
                  BrainNet-8B
                </strong>
                <span className='mt-0.5 block text-[13px] text-[var(--tf-muted)]'>
                  六层决策链路，合成一次 step 路由
                </span>
              </span>
              <span className='shrink-0 rounded-full bg-[var(--tf-pos)] px-3 py-[5px] text-[12px] whitespace-nowrap text-white'>
                决策引擎
              </span>
            </div>
          </div>
        </AnimateInView>
      </div>

      <div className={`${CONTAINER} mt-12`}>
        <p className='text-center text-[14.5px] leading-[1.7] text-[var(--tf-muted)]'>
          在每一步综合分析后，从{' '}
          <b className='font-semibold text-[var(--tf-ink-2)]'>
            GPT / Claude / Gemini / DeepSeek / Qwen / MiniMax / StepFun / Zhipu
          </b>{' '}
          等主流前沿模型中择优
        </p>
        <p className='mt-3 text-center text-[14px] text-[var(--tf-faint)]'>
          <strong className='font-semibold text-[var(--tf-ink-2)]'>
            不是聚合平台
          </strong>{' '}
          —— TierFlow 不做 API 转售，做的是推理路径的智能调度优化。
        </p>
      </div>
    </section>
  )
}
