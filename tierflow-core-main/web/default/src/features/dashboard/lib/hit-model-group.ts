/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 调用模型口径的聚合 —— 数据分析页与用量信息页里所有按模型维度展示的图/表共用。
 *
 * ## 聚合维度是模型组,但对外一个字都不提"模型组"
 *
 * 请求的完整链路是:
 *   请求方案(如 auto)→ 复杂度打分选档位 → 命中模型组 → 组内选成员(渠道 + 上游模型名)
 *
 * 落账时记下的是前两层:`strategy`(第 ① 层,用户请求里的 model 字段)与
 * `model_group`(第 ② 层,命中的模型组名快照)。本模块只认第 ② 层。
 *
 * 之所以能用它当"调用的模型"展示:模型组是同一模型跨多个上游渠道的高可用聚类,
 * **组名就是规范的用户侧模型名**(如「DeepSeek V4 Pro」),而组内成员的上游模型名
 * (第 ④ 层,如 `DeepSeek-V4-Pro`)才是要对用户抽象掉的东西。所以维度取模型组、
 * 措辞用「模型」既准确又不泄露路由内部结构 —— 图表标题/表头一律不写"模型组"、
 * 不写"路由"、不写"命中",分片名直接就是用户认得的模型名。
 *
 * 反过来,通用的 `model_group || strategy` 回落链不能用:它会把第 ① 层的请求方案名
 * 混进同一个图例,同一个模型还会因走没走路由裂成两片。
 *
 * ## 为什么直接丢掉 model_group 为空的行
 *
 * 空值 = 这次请求没有经过模型组路由。产品规则是**不允许**跳过路由点名调用具体模型
 * (`RestrictDirectModelCall`),所以这类流量按定义不该存在,更不该在用户面前占一个
 * 分类位、把路由是否命中这种内部状态摆到台面上。现存的空值几乎全部来自渠道测试探针
 * (`controller/channel-test.go` 以具体上游模型名落账,没有模型组),那是运维探测、
 * 不是业务用量,本就不该进用量看板。
 *
 * ⚠️ 代价:被丢掉的调用不再计入本模块的合计,因此这些图的总量与 KPI 卡(按全量口径)
 * 会对不上。根治在落账侧 —— 渠道测试不该写入 quota_data;展示层不做补偿。
 *
 * ⚠️ 本模块不做 Top-N 折叠,也不产生「其他」:所有模型都具名出现。
 */
import type { QuotaDataItem } from '../types'

const EXCLUDED_APPLIANCE_USAGE_MODELS = new Set(['gpt-5.6-luna'])

/**
 * Exclude legacy aliases that were written by earlier compatibility tests but
 * were never real appliance workloads. Apply this before calculating totals so
 * KPI, trend, model share and per-user statistics stay on the same footing.
 */
export function isVisibleApplianceUsageRow(row: QuotaDataItem): boolean {
  return ![row.model_group, row.strategy]
    .filter((name): name is string => typeof name === 'string')
    .map((name) => name.trim().toLowerCase())
    .some((name) => EXCLUDED_APPLIANCE_USAGE_MODELS.has(name))
}

export interface HitModelGroupSlice {
  /** 展示名:模型组名,即用户侧的规范模型名 */
  name: string
  count: number
  /** 花费(quota 原始单位,展示前经 formatQuota) */
  quota: number
  tokens: number
}

/**
 * 按调用到的模型(= 命中的模型组)聚合调用次数、token 与花费,按调用次数降序。
 * 未经模型组路由的行被丢弃,不参与合计。
 */
export function aggregateByHitModelGroup(
  rows: QuotaDataItem[]
): HitModelGroupSlice[] {
  const acc = new Map<string, HitModelGroupSlice>()

  for (const row of rows) {
    if (!isVisibleApplianceUsageRow(row)) continue
    // Appliance routing may be fixed to a concrete local model. In that mode
    // model_group is intentionally empty, so use the requested model name.
    const name = (row.model_group || row.strategy || '').trim()
    if (name === '') continue
    const existing = acc.get(name)
    const count = Number(row.count) || 0
    const quota = Number(row.quota) || 0
    const tokens = Number(row.token_used) || 0
    if (existing) {
      existing.count += count
      existing.quota += quota
      existing.tokens += tokens
    } else {
      acc.set(name, { name, count, quota, tokens })
    }
  }

  return Array.from(acc.values()).sort((a, b) => b.count - a.count)
}

/**
 * 分类色板的槽位数(--series-1..8)。超出即无色可分,见下。
 */
const PALETTE_SLOTS = 8

/**
 * 第 9 个及以后的分片统一用的中性灰(dataviz 参考色板的 muted ink,亮暗同值)。
 * 用一个"明显不是分类色"的灰,而不是循环回第 1 槽:循环出的色相在色觉障碍下与
 * 已有槽位不可分辨,读图的人会把两个模型当成同一个。
 */
const TAIL_NEUTRAL = '#898781'

/**
 * 模型名 → 槽位偏好的稳定散列(FNV-1a 32 位)。
 *
 * 之所以要散列而不是"按当前分片列表的下标取色":下标依赖**这一次都有哪些模型**,
 * 于是切时间窗多出一个模型、或者换到另一页(本页取 /api/data/self 的自己的数据,
 * 数据分析页取 /api/data 的全站数据,两边模型集合本就不同),整圈颜色都会挪 ——
 * 恰恰违反本函数注释承诺的两件事。散列只依赖模型名本身,所以色随实体走。
 */
function hashSlot(name: string, slots: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % slots
}

/**
 * 为分片构造 VChart 的 ordinal 色标。两个环图共用。
 *
 * **色随实体走**:槽位由模型名散列决定,与调用量排名无关、也与"这次还有哪些模型"
 * 无关 —— 换时间窗、换页面,同一个模型都是同一个颜色。撞槽时按字典序先到先得、
 * 后来者向后线性探测,所以同屏内不会有两个模型同色(≤8 个时);只有**与它撞槽的那个**
 * 模型进出才会让它改色,比原来"任何模型进出都改色"稳定得多。
 *
 * 第 9 个起统一中性灰 —— **不循环**。模型数 >8 时尾部彼此不再靠颜色区分,身份完全
 * 交给常显图例文字与悬停浮层。真要区分那么多类别,环图这个形式本身就到顶了(该换成
 * 单色条形图,类别数不受色板限制)。
 *
 * ⚠️ 两个已知的色板限制,与本函数怎么分配槽位无关:
 * 1. 环图的视觉邻居是按**调用量**排的,不是按色板槽位顺序,所以色板"相邻槽位已校验"
 *    这条保证在这里用不上;而参考色板在 --pairs all 下只有前 3 槽能过门槛。也就是说
 *    ≥4 个模型的环图无法保证任意两片都可分辨(黄↔橙 正常视觉 ΔE 13.7 是最差的一对)。
 * 2. 亮色面上 series-3/4/5(aqua 2.82:1 / yellow 2.17:1 / magenta 2.69:1)低于 3:1。
 *    按 relief 规则这类填充要配一个**常显**数值通道;目前只有数据分析页满足(正下方
 *    的模型调用明细表),用量信息页按产品要求图例只给模型名、数值只在浮层里。
 * 改这三槽的色值前先重跑校验器(命令见 styles/theme.css)。
 */
export function buildHitModelGroupColor(
  slices: HitModelGroupSlice[],
  themeColors: string[],
  fallbackColors: string[]
): { type: 'ordinal'; domain: string[]; range: string[] } {
  const palette = themeColors.length > 0 ? themeColors : fallbackColors
  const usable = Math.min(palette.length, PALETTE_SLOTS)
  // 字典序遍历,保证"谁先占槽"只取决于模型名,不取决于调用量或数组顺序
  const names = slices.map((s) => s.name).sort((a, b) => a.localeCompare(b))
  const taken = new Array<boolean>(usable).fill(false)
  const colorByName = new Map<string, string>()

  for (const name of names) {
    const preferred = hashSlot(name, usable)
    let slot = -1
    for (let step = 0; step < usable; step++) {
      const candidate = (preferred + step) % usable
      if (!taken[candidate]) {
        slot = candidate
        break
      }
    }
    if (slot < 0) {
      // 槽位用尽(模型数 > 8):落到中性灰,不循环回已用色相
      colorByName.set(name, TAIL_NEUTRAL)
      continue
    }
    taken[slot] = true
    colorByName.set(name, palette[slot])
  }

  return {
    type: 'ordinal',
    domain: names,
    range: names.map((name) => colorByName.get(name) ?? TAIL_NEUTRAL),
  }
}
