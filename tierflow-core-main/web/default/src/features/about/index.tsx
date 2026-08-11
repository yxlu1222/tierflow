/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 关于页 —— 参考 MiniMax 关于页的极简编辑风重做:
 * Hero(关于 TierFlow) → 巨型使命宣言 → 我们在做什么 → 规模数字 → 三条价值观
 * → 收束 CTA。沿用落地页的 `.tf-landing` 品牌 token 体系(MiSans、蓝色强调、
 * 暗色自适应)与 AnimateInView 入场动效;头部/页脚由 PublicLayout 提供。
 */
import { useEffect, useRef, useState } from 'react'
import { Cpu, Scale, ShieldCheck } from 'lucide-react'
import { useSystemConfig } from '@/hooks/use-system-config'
import { AnimateInView } from '@/components/animate-in-view'
import { PublicLayout } from '@/components/layout'

const CONTAINER = 'mx-auto w-full max-w-[1120px] px-[clamp(20px,4vw,40px)]'
const DISPLAY = { fontFamily: 'var(--tf-display)' } as const

/** 数字滚动(count-up),保留非数字前缀(如 “<100ms” 的 “<”)与后缀。 */
function AnimatedNumber({ value }: { value: string }) {
  const match = value.match(/^(\D*)(\d+)(.*)$/)
  const prefix = match ? match[1] : ''
  const target = match ? parseInt(match[2], 10) : 0
  const suffix = match ? match[3] : ''
  // 尊重 prefers-reduced-motion:直接以目标值初始化,不做滚动(避免在 effect 里同步 setState)。
  const [n, setN] = useState(() =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? target
      : 0
  )
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || target === 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        let start = 0
        const duration = 1500
        const step = (t: number) => {
          if (!start) start = t
          const p = Math.min((t - start) / duration, 1)
          const ease = 1 - Math.pow(1 - p, 4)
          setN(Math.floor(ease * target))
          if (p < 1) raf = requestAnimationFrame(step)
          else setN(target)
        }
        raf = requestAnimationFrame(step)
      },
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [target])

  return (
    <span ref={ref} className='tabular-nums'>
      {prefix}
      {target > 0 ? n : value}
      {suffix}
    </span>
  )
}

const stats = [
  { value: '40+', label: '接入前沿模型厂商' },
  { value: '500+', label: '可调度模型' },
  { value: '99.9%', label: '服务可用性' },
  { value: '<100ms', label: '单步决策延迟' },
]

const values = [
  {
    icon: ShieldCheck,
    en: 'No Shortcuts',
    title: '不走捷径',
    desc: '质量优先,绝不为省钱牺牲完成率。每一次路由都对最终结果负责,而不是把成本转嫁给你的用户。',
  },
  {
    icon: Scale,
    en: 'Global Optimum',
    title: '全局最优',
    desc: '在质量、成本、速度与稳定之间求整体最优解,而非单点妥协。让旗舰算力专攻难题,轻量算力处理日常。',
  },
  {
    icon: Cpu,
    en: 'Technology-Driven',
    title: '技术驱动',
    desc: '用自研决策模型与工程能力,把前沿模型变成可靠的生产级基础设施——模型生态的变化,对你透明。',
  },
]

function DefaultAbout() {
  const { systemName } = useSystemConfig()
  const name = systemName || 'TierFlow'

  return (
    <div className='tf-landing relative overflow-x-clip'>
      {/* ===== Hero ===== */}
      <section className='relative overflow-hidden'>
        {/* aurora 背景 */}
        <div
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 -z-10'
          style={{
            background:
              'radial-gradient(60% 60% at 78% 8%, var(--tf-pos-soft) 0%, transparent 60%), radial-gradient(50% 50% at 12% 0%, rgba(53,60,166,0.08) 0%, transparent 55%)',
          }}
        />
        <div
          className={`${CONTAINER} pt-[clamp(120px,15vh,176px)] pb-[clamp(40px,5vw,72px)]`}
        >
          <AnimateInView animation='fade-up'>
            <h1
              className='max-w-[900px] text-[clamp(38px,6vw,74px)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              关于 {name}
            </h1>
            <p className='mt-6 max-w-[620px] text-[clamp(16px,1.4vw,19px)] leading-[1.7] text-pretty text-[var(--tf-muted)]'>
              {name} 是一个面向智能体时代的
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                推理结构感知调度平台
              </b>
              。只需一个 OpenAI 兼容的 API,就能在每一步为你的 Agent
              选出最合适的模型。
            </p>
          </AnimateInView>
        </div>
      </section>

      {/* ===== 使命宣言(巨型编辑体) ===== */}
      <section className='border-y border-[var(--tf-line)] bg-[var(--tf-surface-2)] py-[clamp(48px,6vw,84px)]'>
        <div className={`${CONTAINER} text-center`}>
          <AnimateInView animation='fade-up'>
            <span className='text-[13px] font-medium tracking-[0.14em] text-[var(--tf-pos)] uppercase'>
              Our Mission · 我们的使命
            </span>
            <p
              className='mx-auto mt-7 max-w-[900px] text-[clamp(28px,4.4vw,54px)] leading-[1.18] font-semibold tracking-[-0.03em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              让算力,在每一步
              <br className='hidden sm:block' />
              流向最该去的地方。
            </p>
            <p className='mx-auto mt-7 max-w-[560px] text-[clamp(15px,1.2vw,17px)] leading-[1.7] text-[var(--tf-muted)]'>
              不止聚合模型,而是重构算力流向——让每一步推理都用最合适的模型,不浪费,也不妥协。
            </p>
          </AnimateInView>
        </div>
      </section>

      {/* ===== 我们在做什么 ===== */}
      <section className='py-[clamp(48px,6vw,84px)]'>
        <div
          className={`${CONTAINER} grid grid-cols-1 gap-[clamp(32px,6vw,88px)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]`}
        >
          <AnimateInView animation='fade-up'>
            <h2
              className='text-[clamp(28px,3.6vw,42px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              我们在做什么
            </h2>
          </AnimateInView>
          <AnimateInView animation='fade-up' delay={100}>
            <div className='flex flex-col gap-6 text-[clamp(16px,1.2vw,18px)] leading-[1.75] text-[var(--tf-muted)]'>
              <p>
                {name} 是一个
                <b className='font-semibold text-[var(--tf-ink-2)]'>
                  推理结构感知的调度引擎
                </b>
                。它在每一步判断任务难度、上下文价值、模型能力与算力状态,自动为每个
                step 选出最优模型与执行路径。
              </p>
              <p>
                我们自研 8B 任务感知决策模型{' '}
                <b className='font-semibold text-[var(--tf-ink-2)]'>
                  BrainNet-8B
                </b>
                ,把任务理解、复杂度评估、上下文压缩与成本预测合成为一次 step
                级决策,平均 100ms 内完成最优路由。
              </p>
              <p>
                在一个 OpenAI 兼容的 API 背后,{name} 聚合 40+ 前沿厂商、500+
                模型,内建
                <b className='font-semibold text-[var(--tf-ink-2)]'>
                  智能路由、分层计费与实时分析
                </b>
                ——把前沿模型变成任何规模团队都能依赖的生产级基础设施。
              </p>
            </div>
          </AnimateInView>
        </div>
      </section>

      {/* ===== 规模数字 ===== */}
      <section className='border-t border-[var(--tf-line)] py-[clamp(48px,6vw,84px)]'>
        <div className={CONTAINER}>
          <div className='grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4'>
            {stats.map((s, i) => (
              <AnimateInView key={s.label} animation='fade-up' delay={i * 80}>
                <div>
                  <div
                    className='text-[clamp(40px,5.5vw,64px)] leading-none font-semibold tracking-[-0.03em] text-[var(--tf-ink)]'
                    style={DISPLAY}
                  >
                    <AnimatedNumber value={s.value} />
                  </div>
                  <div className='mt-4 text-[14px] text-[var(--tf-muted)]'>
                    {s.label}
                  </div>
                </div>
              </AnimateInView>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 价值观 ===== */}
      <section className='border-t border-[var(--tf-line)] bg-[var(--tf-surface-2)] py-[clamp(48px,6vw,84px)]'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <div className='max-w-[720px]'>
              <span className='text-[13px] font-medium tracking-[0.14em] text-[var(--tf-muted)] uppercase'>
                Our Values · 我们坚持的
              </span>
              <h2
                className='mt-3.5 text-[clamp(28px,3.8vw,44px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
                style={DISPLAY}
              >
                指引我们每一次决策的准则
              </h2>
            </div>
          </AnimateInView>

          <div className='mt-9 grid grid-cols-1 gap-4 md:grid-cols-3'>
            {values.map((v, i) => (
              <AnimateInView key={v.title} animation='fade-up' delay={i * 90}>
                <div className='flex h-full flex-col rounded-2xl border border-[var(--tf-line)] bg-[var(--tf-surface)] px-7 py-8'>
                  <div className='grid size-11 place-items-center rounded-[14px] bg-[var(--tf-pos-soft)] text-[var(--tf-pos)]'>
                    <v.icon className='size-[22px]' strokeWidth={1.8} />
                  </div>
                  <div className='mt-6 text-[12px] font-medium tracking-[0.12em] text-[var(--tf-faint)] uppercase'>
                    {v.en}
                  </div>
                  <h3
                    className='mt-1.5 text-[21px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                    style={DISPLAY}
                  >
                    {v.title}
                  </h3>
                  <p className='mt-3 text-[14.5px] leading-[1.7] text-[var(--tf-muted)]'>
                    {v.desc}
                  </p>
                </div>
              </AnimateInView>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

export function About() {
  return (
    <PublicLayout showMainContainer={false}>
      <DefaultAbout />
    </PublicLayout>
  )
}
