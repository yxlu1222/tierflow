/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * PinchBench OpenClaw 多阶段智能体任务的实测快照 —— 落地页所有基准数字的唯一来源。
 *
 * 首屏指标、01 的两种跑法对照、03 的散点与排行榜用的是同一组数字,过去它们各写死
 * 一份,更新基准时改漏一处,同一屏就会出现互相矛盾的成本与完成率。所以这里只存一份
 * 原始行,其余全部派生:要更新实测结果,改 BENCH_ROWS 即可。
 *
 * 这是一次特定基准的快照,不随线上流量变化,和 /dashboard 的实时用量不是一回事。
 */

export interface BenchRow {
  name: string
  /** 散点上的短标签,长名字会撞在一起 */
  short: string
  /** 任务完成率(%) */
  score: number
  /** 单任务平均成本(元) */
  cost: number
  /** 标签压到点下方 —— 邻近的点交替上下排,否则短标签会互相压住 */
  below?: boolean
  isTierFlow?: boolean
}

export const BENCH_ROWS: BenchRow[] = [
  {
    name: 'TierFlow',
    short: 'TierFlow',
    score: 91.6,
    cost: 2.04,
    isTierFlow: true,
  },
  { name: 'Claude Opus 4.6', short: 'Opus 4.6', score: 82.3, cost: 17.62 },
  {
    name: 'Claude Sonnet 4.5',
    short: 'Sonnet 4.5',
    score: 80.7,
    cost: 15.52,
    below: true,
  },
  { name: 'GPT-5.4', short: 'GPT-5.4', score: 80.65, cost: 9.72 },
  {
    name: 'Claude Sonnet 4.6',
    short: 'Sonnet 4.6',
    score: 80.0,
    cost: 10.88,
    below: true,
  },
  { name: 'Claude Opus 4.5', short: 'Opus 4.5', score: 79.2, cost: 23.49 },
  {
    name: 'Qwen3.5-27B',
    short: 'Qwen 27B',
    score: 78.5,
    cost: 3.26,
    below: true,
  },
  { name: 'MiniMax2.7', short: 'MiniMax', score: 77.21, cost: 4.85 },
  {
    name: 'Gemini 3.1 Pro',
    short: 'Gemini 3.1',
    score: 75.9,
    cost: 8.27,
    below: true,
  },
  { name: 'Qwen3-Max-Thinking', short: 'Qwen Max', score: 71.8, cost: 13.56 },
  { name: 'Gemini 3 Pro', short: 'Gemini 3', score: 70.7, cost: 26.17 },
  {
    name: 'GLM-4.5-Air',
    short: 'GLM Air',
    score: 68.69,
    cost: 0.41,
    below: true,
  },
]

/** TierFlow 自己那行 */
export const TIERFLOW = BENCH_ROWS.find((r) => r.isTierFlow)!
/** 对照组 —— 「全程旗舰模型」那种跑法的代表 */
export const BASELINE = BENCH_ROWS.find((r) => r.name === 'Claude Opus 4.6')!

/** 成本效率倍数,如 8.6(倍) */
export const COST_EFFICIENCY = (BASELINE.cost / TIERFLOW.cost).toFixed(1)
/** TierFlow 成本占对照组的百分比,给成本条用 */
export const COST_SHARE_PCT = (TIERFLOW.cost / BASELINE.cost) * 100
/** 成本降到几分之一,如 9 —— 用于「成本仅为 1/9」 */
export const COST_FRACTION = Math.round(BASELINE.cost / TIERFLOW.cost)
