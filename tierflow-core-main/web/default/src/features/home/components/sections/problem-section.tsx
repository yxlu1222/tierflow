/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 01 / 你的 Agent 为什么花了太多钱 —— 同一任务两种跑法的对照 + 成本去向条。
 *
 * 论点的落点是「双重付费」:既为用不上的模型能力付费,也为用不到的 Token 付费。
 * 所以先用两张卡把成本与完成率同时摆出来(便宜且更准,才构成说服),再用一条
 * 分段条说明钱具体浪费在哪一段。
 */
import { AnimateInView } from '@/components/animate-in-view'
import { CONTAINER, DISPLAY, Eyebrow } from '@/components/landing-kit'
import { BASELINE, COST_FRACTION, COST_SHARE_PCT, TIERFLOW } from './bench-data'

/** 传统跑法里「本可以用轻量算力」的步骤占比 */
const WASTE_SHARE = 68

export function ProblemSection() {
  return (
    <section
      id='problem'
      // 紧接首屏,不加分隔线 —— 首屏本身已经留够了收束的空白;
      // scroll-mt 让锚点跳转避开 80px 的固定头部
      className='scroll-mt-[88px] pt-[clamp(28px,3.5vw,44px)] pb-[clamp(32px,4vw,52px)]'
    >
      <div className={CONTAINER}>
        <AnimateInView animation='fade-up'>
          <div className='mx-auto max-w-[720px] text-center'>
            <Eyebrow index='01' label='你的 Agent 为什么花了太多钱' />
            <h2
              className='m-0 mt-3.5 text-[clamp(30px,4vw,46px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              同一个任务，两种跑法
            </h2>
            <p className='m-0 mt-5 text-[clamp(16px,1.2vw,18px)] leading-[1.7] text-pretty text-[var(--tf-muted)]'>
              Agent 任务的大部分步骤，是检索、格式化、确认这类简单工作。
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                全程调用旗舰模型、携带全量上下文，就是在为用不上的能力和用不到的
                Token 双重付费。
              </b>
            </p>
          </div>
        </AnimateInView>

        {/* 两种跑法对照 */}
        <AnimateInView animation='fade-up' delay={80}>
          <div className='mx-auto mt-10 grid max-w-[920px] grid-cols-1 items-stretch gap-[clamp(12px,2vw,24px)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]'>
            <div className='rounded-[18px] border border-[var(--tf-line)] bg-[var(--tf-surface-2)] px-7 pt-9 pb-7 text-center'>
              <div className='text-[14px] font-semibold text-[var(--tf-muted)]'>
                传统跑法 · 全程旗舰模型
              </div>
              <div className='mt-[7px] text-[12.5px] text-[var(--tf-faint)]'>
                单一模型跑全程 · 上下文全量携带
              </div>
              <div
                className='mt-4 text-[clamp(44px,5vw,60px)] leading-none font-bold tracking-[-0.03em] text-[var(--tf-faint)] tabular-nums'
                style={DISPLAY}
              >
                ¥{BASELINE.cost}
              </div>
              <div className='mt-2.5 text-[13px] text-[var(--tf-faint)]'>
                单任务平均成本（以 {BASELINE.short} 为例）
              </div>
              <div className='mt-5 border-t border-dashed border-[var(--tf-line-2)] pt-4 text-[14.5px] text-[var(--tf-muted)]'>
                完成率{' '}
                <b className='font-semibold text-[var(--tf-ink-2)]'>
                  {BASELINE.score}%
                </b>
              </div>
            </div>

            <div
              className='mx-auto grid size-[46px] shrink-0 place-items-center self-center rounded-full bg-[var(--tf-ink)] text-[13px] font-semibold text-white'
              style={DISPLAY}
            >
              VS
            </div>

            <div className='relative rounded-[18px] border-[1.5px] border-[var(--tf-pos)] bg-[var(--tf-surface)] px-7 pt-9 pb-7 text-center shadow-[0_10px_36px_var(--tf-pos-soft)]'>
              <span className='absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-[var(--tf-pos)] px-4 py-[5px] text-[12.5px] font-semibold whitespace-nowrap text-white'>
                成本仅为 1/{COST_FRACTION}
              </span>
              <div className='text-[14px] font-semibold text-[var(--tf-pos)]'>
                TierFlow 跑法 · 逐步智能调度
              </div>
              <div className='mt-[7px] text-[12.5px] text-[var(--tf-pos)] opacity-80'>
                逐步调度 · 上下文精炼 · 记忆优化
              </div>
              <div
                className='mt-4 text-[clamp(44px,5vw,60px)] leading-none font-bold tracking-[-0.03em] text-[var(--tf-ink)] tabular-nums'
                style={DISPLAY}
              >
                ¥{TIERFLOW.cost}
              </div>
              <div className='mt-2.5 text-[13px] text-[var(--tf-faint)]'>
                单任务平均成本
              </div>
              <div className='mt-5 border-t border-dashed border-[var(--tf-line-2)] pt-4 text-[14.5px] text-[var(--tf-muted)]'>
                完成率{' '}
                <b className='font-semibold text-[var(--tf-pos)]'>
                  {TIERFLOW.score}%
                </b>
              </div>
            </div>
          </div>
        </AnimateInView>

        <p className='mt-3.5 text-center text-[12.5px] text-[var(--tf-faint)]'>
          PinchBench OpenClaw 多阶段智能体任务实测 · 成本与完成率均为任务级平均
        </p>

        {/* 成本去向 */}
        <AnimateInView animation='fade-up' delay={140}>
          <div className='mx-auto mt-9 max-w-[920px]'>
            <div className='mb-4 text-center text-[13px] text-[var(--tf-muted)]'>
              一个典型 Agent 任务的成本去向
            </div>

            <div className='grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-3.5 sm:grid-cols-[88px_minmax(0,1fr)_80px]'>
              <div className='text-right text-[13.5px] font-medium text-[var(--tf-muted)]'>
                传统跑法
              </div>
              <div className='flex'>
                <div
                  className='flex h-[42px] items-center overflow-hidden rounded-l-[10px] border border-r-0 border-[var(--tf-line)] px-4 text-[12.5px] whitespace-nowrap text-[var(--tf-muted)]'
                  style={{
                    width: `${WASTE_SHARE}%`,
                    background:
                      'repeating-linear-gradient(135deg,#F1F2F4 0 8px,#E8EAED 8px 16px)',
                  }}
                >
                  <span className='truncate'>简单步骤 · 轻量算力就足够</span>
                </div>
                <div
                  className='flex h-[42px] items-center overflow-hidden rounded-r-[10px] bg-[#B7BEC9] px-4 text-[12.5px] font-medium whitespace-nowrap text-white'
                  style={{ width: `${100 - WASTE_SHARE}%` }}
                >
                  <span className='truncate'>关键步骤 · 需要旗舰算力</span>
                </div>
              </div>
              <div className='text-right text-[13.5px] font-medium text-[var(--tf-ink-2)] tabular-nums'>
                ¥{BASELINE.cost}
              </div>
            </div>

            <div className='mt-3 grid grid-cols-[64px_minmax(0,1fr)_72px] items-center gap-3.5 sm:grid-cols-[88px_minmax(0,1fr)_80px]'>
              <div className='text-right text-[13.5px] font-semibold text-[var(--tf-pos)]'>
                TierFlow
              </div>
              <div className='flex'>
                <div
                  className='h-[42px] rounded-[10px] bg-[var(--tf-pos)]'
                  style={{
                    width: `${COST_SHARE_PCT.toFixed(1)}%`,
                  }}
                />
              </div>
              <div className='text-right text-[13.5px] font-semibold text-[var(--tf-pos)] tabular-nums'>
                ¥{TIERFLOW.cost}
              </div>
            </div>

            {/* 图例 —— 条形本身在窄屏会藏掉文字,靠图例把两段的含义补回来 */}
            <div className='mt-3.5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12.5px] text-[var(--tf-faint)]'>
              <span className='inline-flex items-center gap-1.5'>
                <i
                  aria-hidden='true'
                  className='inline-block size-2.5 rounded-[3px] border border-[var(--tf-line)]'
                  style={{
                    background:
                      'repeating-linear-gradient(135deg,#F1F2F4 0 3px,#E8EAED 3px 6px)',
                  }}
                />
                简单步骤 · 轻量算力足够
              </span>
              <span className='inline-flex items-center gap-1.5'>
                <i
                  aria-hidden='true'
                  className='inline-block size-2.5 rounded-[3px] bg-[#B7BEC9]'
                />
                关键步骤 · 需要旗舰算力
              </span>
            </div>

            <p className='mt-6 text-center text-[15.5px] leading-[1.7] text-[var(--tf-muted)]'>
              <b className='font-semibold text-[var(--tf-pos)]'>
                TierFlow 逐步调度，每一步只为它真正需要的算力付费。
              </b>
              <span className='mt-2.5 block text-[14px] text-[var(--tf-muted)]'>
                同时自动精炼上下文、整理跨步骤记忆，同等效果下 Token 消耗再降
                60%+。
              </span>
            </p>
          </div>
        </AnimateInView>
      </div>
    </section>
  )
}
