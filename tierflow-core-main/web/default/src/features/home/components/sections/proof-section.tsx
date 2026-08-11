/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 03 / 性能实测 —— 成功率 × 成本散点图 + Top5 排行榜。
 *
 * 数字全部来自 ./bench-data 的 BENCH_ROWS(落地页的唯一基准来源),本文件只负责
 * 把它画成散点与排行榜。
 *
 * 坐标轴用百分比定位而不是图表库:只有十来个点、两条轴,引一个 VChart 进营销页
 * 首屏得不偿失(那是 dashboard 才需要的量级)。
 */
import { AnimateInView } from '@/components/animate-in-view'
import { CONTAINER, DISPLAY, Eyebrow } from '@/components/landing-kit'
import { BENCH_ROWS, TIERFLOW } from './bench-data'

/** 坐标轴刻度 —— 与 xPct / yPct 的映射同源,改坐标范围时两边一起动 */
const X_TICKS = [0, 7, 14, 21, 28]
const Y_TICKS = [70, 80, 90]

// 坐标范围:留出边距,避免点贴在框线上
const COST_MAX = 28
const SCORE_MIN = 65
const SCORE_MAX = 95

const xPct = (cost: number) => 8 + (cost / COST_MAX) * 84
const yPct = (score: number) =>
  8 + ((score - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 84

const TOP5 = [...BENCH_ROWS].sort((a, b) => b.score - a.score).slice(0, 5)

function Scatter() {
  return (
    // 左侧 / 下方留白给刻度标签,坐标区本身只画左轴与底轴两条线
    <div className='px-6 pb-2'>
      <div className='relative mb-11 ml-[34px] h-[clamp(230px,26vw,264px)] border-b border-l border-[var(--tf-line-2)]'>
        {/* 理想区：左上角 —— 便宜且完成率高 */}
        <span
          aria-hidden='true'
          className='pointer-events-none absolute top-0 left-0 h-[48%] w-[42%]'
          style={{
            background:
              'radial-gradient(ellipse at 0% 0%, var(--tf-pos-soft), transparent 72%)',
          }}
        />
        <span className='pointer-events-none absolute top-1.5 left-2 text-[10.5px] tracking-[0.08em] text-[var(--tf-pos)] opacity-60'>
          更优
        </span>

        {/* 网格线 + 刻度 */}
        {Y_TICKS.map((t) => (
          <span key={`y-${t}`}>
            <span
              aria-hidden='true'
              className='absolute right-0 left-0 h-px bg-[var(--tf-line)]'
              style={{ bottom: `${yPct(t)}%` }}
            />
            <span
              className='tf-mono absolute -left-[30px] w-[22px] translate-y-1/2 text-right text-[10.5px] text-[var(--tf-faint)]'
              style={{ bottom: `${yPct(t)}%` }}
            >
              {t}
            </span>
          </span>
        ))}
        {X_TICKS.map((t) => (
          <span key={`x-${t}`}>
            {t > 0 && t < 28 && (
              <span
                aria-hidden='true'
                className='absolute top-0 bottom-0 w-px bg-[var(--tf-line)] opacity-70'
                style={{ left: `${xPct(t)}%` }}
              />
            )}
            <span
              className='tf-mono absolute -bottom-5 -translate-x-1/2 text-[10.5px] text-[var(--tf-faint)]'
              style={{ left: `${xPct(t)}%` }}
            >
              {t}
            </span>
          </span>
        ))}

        {/* 轴名 */}
        <span className='absolute -top-1 -left-[34px] text-[11px] text-[var(--tf-faint)]'>
          Score %
        </span>
        <span className='absolute right-0 -bottom-9 text-[11px] text-[var(--tf-faint)]'>
          Cost (¥)
        </span>

        {BENCH_ROWS.map((row) => {
          const left = xPct(row.cost)
          const bottom = yPct(row.score)
          // 贴边的点把浮层往回收,否则会被坐标区裁掉
          const tipShift = left > 72 ? '-85%' : left < 20 ? '-15%' : '-50%'
          // 高处的点浮层放下方,免得顶出卡片
          const tipBelow = bottom > 72
          return (
            <span
              key={row.name}
              tabIndex={0}
              // 悬停时把整个点提到最上层 —— 浮层的 z-index 只在本点的层叠上下文
              // 内生效,不提这一层就会被后面的点和标签盖住
              className='group absolute -translate-x-1/2 translate-y-1/2 rounded-full hover:z-20 focus:z-20 focus:outline-none'
              style={{ left: `${left}%`, bottom: `${bottom}%` }}
            >
              <span
                className={
                  row.isTierFlow
                    ? 'block size-[18px] rounded-full bg-[var(--tf-pos)] shadow-[0_0_0_5px_var(--tf-pos-soft)]'
                    : 'block size-[11px] rounded-full bg-[var(--tf-faint)] opacity-40 transition-opacity group-hover:opacity-80'
                }
              />
              <span
                className={`absolute left-1/2 -translate-x-1/2 text-[10.5px] whitespace-nowrap ${
                  row.below ? 'top-full mt-1' : 'bottom-full mb-1'
                } ${
                  row.isTierFlow
                    ? 'text-[11px] font-semibold text-[var(--tf-pos)]'
                    : 'text-[var(--tf-faint)]'
                }`}
              >
                {row.short}
              </span>

              {/* 悬停浮层 —— 短标签只够认出是谁,具体数字放这里 */}
              <span
                className={`invisible absolute left-1/2 z-10 min-w-[124px] rounded-[10px] border border-[var(--tf-line-2)] bg-[var(--tf-surface)] px-3 py-2.5 opacity-0 shadow-[0_1px_3px_rgba(15,23,42,.05),0_8px_30px_rgba(15,23,42,.09)] transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 ${
                  tipBelow
                    ? 'top-[calc(100%_+_9px)]'
                    : 'bottom-[calc(100%_+_9px)]'
                }`}
                style={{ transform: `translateX(${tipShift})` }}
              >
                <span
                  className={`mb-1.5 block text-[12.5px] font-semibold tracking-[-0.01em] whitespace-nowrap ${
                    row.isTierFlow
                      ? 'text-[var(--tf-pos)]'
                      : 'text-[var(--tf-ink)]'
                  }`}
                  style={DISPLAY}
                >
                  {row.name}
                </span>
                <span className='flex items-center justify-between gap-4 text-[11.5px]'>
                  <span className='text-[var(--tf-faint)]'>完成率</span>
                  <span
                    className={`tabular-nums ${row.isTierFlow ? 'text-[var(--tf-pos)]' : 'text-[var(--tf-ink-2)]'}`}
                  >
                    {row.score}%
                  </span>
                </span>
                <span className='flex items-center justify-between gap-4 text-[11.5px]'>
                  <span className='text-[var(--tf-faint)]'>成本</span>
                  <span
                    className={`tabular-nums ${row.isTierFlow ? 'text-[var(--tf-pos)]' : 'text-[var(--tf-ink-2)]'}`}
                  >
                    ¥{row.cost}
                  </span>
                </span>
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function ProofSection() {
  return (
    <section
      id='proof'
      // 固定头部 80px,锚点跳转要留出偏移,否则标题被盖住
      className='scroll-mt-[88px] border-t border-[var(--tf-line)] bg-[var(--tf-surface-2)] py-[clamp(48px,6vw,80px)]'
    >
      <div className={CONTAINER}>
        <AnimateInView animation='fade-up'>
          <div className='max-w-[720px]'>
            <Eyebrow index='03' label='性能实测' />
            <h2
              className='m-0 mt-3.5 text-[clamp(30px,4vw,46px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              更低成本，更高完成率
            </h2>
            <p className='m-0 mt-5 text-[clamp(16px,1.2vw,18px)] leading-[1.7] text-pretty text-[var(--tf-muted)]'>
              在{' '}
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                PinchBench OpenClaw
              </b>{' '}
              多阶段智能体任务上，TierFlow 按 step
              动态选模，以远低于任一单模型的成本达到最高完成率。
            </p>
          </div>
        </AnimateInView>

        <div className='mt-11 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'>
          <AnimateInView animation='fade-up'>
            <article className='h-full rounded-2xl border border-[var(--tf-line)] bg-[var(--tf-surface)] pt-6'>
              <div className='mb-5 flex items-center justify-between px-6'>
                <h3
                  className='text-[17px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                  style={DISPLAY}
                >
                  成功率 × 成本
                </h3>
                <span className='rounded-full border border-[var(--tf-line)] px-3 py-1 text-[11.5px] text-[var(--tf-muted)]'>
                  PinchBench OpenClaw
                </span>
              </div>
              <Scatter />
              <p className='m-0 flex items-center gap-2.5 px-6 pb-6 text-[13px] text-[var(--tf-muted)]'>
                <span
                  aria-hidden='true'
                  className='inline-block size-2.5 shrink-0 rounded-full bg-[var(--tf-pos)] ring-[3px] ring-[var(--tf-pos-soft)]'
                />
                TierFlow 位于左上角——完成率最高、成本最低
              </p>
            </article>
          </AnimateInView>

          <AnimateInView animation='fade-up' delay={90}>
            <article className='flex h-full flex-col rounded-2xl border border-[var(--tf-line)] bg-[var(--tf-surface)] p-6'>
              <div className='mb-5 flex items-center justify-between'>
                <h3
                  className='text-[17px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                  style={DISPLAY}
                >
                  排行榜
                </h3>
                <span className='rounded-full border border-[var(--tf-line)] px-3 py-1 text-[11.5px] text-[var(--tf-muted)]'>
                  TOP 5
                </span>
              </div>

              <div className='grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0 text-[12px] tracking-[0.03em] text-[var(--tf-faint)]'>
                <span />
                <span>模型</span>
                <span className='text-right'>完成率</span>
                <span className='text-right'>成本</span>
              </div>

              <div className='mt-2 flex flex-1 flex-col'>
                {TOP5.map((row, i) => (
                  <div
                    key={row.name}
                    className={`grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-3 text-[13.5px] ${
                      row.isTierFlow
                        ? '-mx-2 rounded-[10px] bg-[var(--tf-pos-soft)] px-2'
                        : 'border-t border-[var(--tf-line)]'
                    }`}
                  >
                    <span
                      className={`text-[12.5px] tabular-nums ${
                        row.isTierFlow
                          ? 'font-semibold text-[var(--tf-pos)]'
                          : 'text-[var(--tf-faint)]'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={`truncate ${
                        row.isTierFlow
                          ? 'font-semibold text-[var(--tf-pos)]'
                          : 'text-[var(--tf-ink-2)]'
                      }`}
                    >
                      {row.name}
                    </span>
                    <span className='text-right text-[var(--tf-ink)] tabular-nums'>
                      {row.score}%
                    </span>
                    <span
                      className={`text-right tabular-nums ${
                        row.isTierFlow
                          ? 'font-semibold text-[var(--tf-pos)]'
                          : 'text-[var(--tf-muted)]'
                      }`}
                    >
                      ¥{row.cost}
                    </span>
                  </div>
                ))}
              </div>

              <div className='mt-5 flex items-baseline justify-between border-t border-[var(--tf-line)] pt-4'>
                <span className='text-[13px] text-[var(--tf-muted)]'>
                  平均任务成本
                </span>
                <b
                  className='text-[22px] leading-tight font-semibold text-[var(--tf-pos)] tabular-nums'
                  style={DISPLAY}
                >
                  ¥{TIERFLOW.cost}
                </b>
              </div>
            </article>
          </AnimateInView>
        </div>
      </div>
    </section>
  )
}
