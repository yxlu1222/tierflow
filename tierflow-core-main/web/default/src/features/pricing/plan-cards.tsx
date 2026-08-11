/*
Copyright (C) 2023-2026 TierFlow
*/
/* eslint-disable react-refresh/only-export-components -- 本文件有意集中导出定价卡片 + 配套的数据 hook/常量 */
/**
 * 套餐卡片与套餐数据层 —— 目前由独立定价页(/pricing)使用。
 *
 * 卡片与取数放在一起，是为了让任何要展示价格的地方都只能走 usePublicPlanTiers:
 * 写死一份价格在页面里，后台改了套餐就会长期不一致，而价格恰恰是用户最会当真的。
 *
 * 计费模型(一个套餐 = 两个独立的桶):
 * - 高级模型：一笔人民币额度，每次调用按售卖价扣钱
 * - 基础模型：一份 token 总量，每次调用按 token 数扣
 * 走哪一类由 TierFlow 自动决定；高级额度不足以覆盖本次调用时降级到基础模型。
 * 套餐有效期 30 天，到期两桶一并清零；套餐绑定专用 API Key，不与钱包余额互通。
 *
 * 数据来源：优先取 /api/subscription/public_plans(无鉴权)；接口为空
 * (未配置套餐/合规未确认)或失败时，回落到静态 PRICING_TIERS。
 */
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { quotaUnitsToDollars } from '@/lib/format'
import { DISPLAY } from '@/components/landing-kit'

export interface PricingTier {
  key: string
  name: string
  /** 一句话说清这档卖给谁 */
  tagline: string
  /** 售价(元 / 30 天) */
  price: number
  /** 高级模型额度(元) */
  advancedCredit: number
  /** 基础模型 token 总量；null = 无限量 */
  baseTokens: string | null
  recommended?: boolean
  /** 后端套餐 id；静态兜底数据无 id，跳转时不带 plan 参数 */
  planId?: number
}

/** 仅作 usePublicPlanTiers 的兜底初值 —— 刻意不导出，免得有人绕过接口直接引它渲染价格 */
const PRICING_TIERS: PricingTier[] = [
  {
    key: 'lite',
    name: 'Lite',
    tagline: '轻量试用，先跑通链路',
    price: 9.9,
    advancedCredit: 9.9,
    baseTokens: '500 万 token',
  },
  {
    key: 'standard',
    name: 'Standard',
    tagline: '日常开发的常规用量',
    price: 39.9,
    advancedCredit: 39.9,
    baseTokens: '1800 万 token',
  },
  {
    key: 'pro',
    name: 'Pro',
    tagline: '高频调用，基础模型不设上限',
    price: 69.9,
    advancedCredit: 99.9,
    baseTokens: null,
    recommended: true,
  },
  {
    key: 'max',
    name: 'Max',
    tagline: '团队级用量，高级额度翻倍',
    price: 149.9,
    advancedCredit: 199,
    baseTokens: null,
  },
]

// 后端 public_plans 条目(只取展示所需字段)
interface PublicPlanEntry {
  plan?: {
    id: number
    title: string
    subtitle?: string
    price_amount: number
    total_amount: number
    basic_token_total?: number
    sort_order?: number
    recommended?: boolean
  }
}

function formatTokenAmount(n: number): string {
  if (n >= 100_000_000)
    return `${(n / 100_000_000).toFixed(n % 100_000_000 === 0 ? 0 : 1)} 亿 token`
  if (n >= 10_000) return `${Math.round(n / 10_000)} 万 token`
  return `${n} token`
}

// 把后端套餐映射为营销卡片形态；推荐标记由管理端「推荐」开关控制
function plansToTiers(entries: PublicPlanEntry[]): PricingTier[] {
  const plans = entries
    .map((e) => e.plan)
    .filter((p): p is NonNullable<PublicPlanEntry['plan']> => !!p)
  if (plans.length === 0) return []
  return plans
    .slice()
    .sort((a, b) => (a.price_amount || 0) - (b.price_amount || 0))
    .map((p) => {
      const basic = Number(p.basic_token_total || 0)
      return {
        key: `plan-${p.id}`,
        planId: p.id,
        name: p.title,
        tagline: p.subtitle || '',
        price: Number(p.price_amount || 0),
        advancedCredit:
          Math.round(quotaUnitsToDollars(Number(p.total_amount || 0)) * 10) /
          10,
        baseTokens:
          basic === -1 ? null : basic === 0 ? '—' : formatTokenAmount(basic),
        recommended: p.recommended === true,
      }
    })
}

/** gift-tag：参考稿 .gift-tag —— 额度标签旁的蓝底「赠送」小徽章 */
function GiftTag({ children }: { children: React.ReactNode }) {
  return (
    <span className='ml-[7px] inline-block rounded-[5px] bg-[var(--tf-pos)] px-2 py-px align-[1.5px] text-[10.5px] font-semibold tracking-[0.02em] text-white'>
      {children}
    </span>
  )
}

/** pblock：参考稿 .pblock 的配额小块(灰底；推荐卡为浅蓝底) */
function PBlock(props: {
  label: string
  /** 标签右侧的赠送徽章文案(参考稿 .gift-tag)；空则不渲染 */
  tag?: string
  hot?: boolean
  children: React.ReactNode
  cap?: string
}) {
  return (
    <div
      className={`mt-2.5 rounded-[14px] px-4 py-3.5 ${
        props.hot ? 'bg-[var(--tf-pos-soft)]' : 'bg-[var(--tf-surface-2)]'
      }`}
    >
      <div className='text-[12.5px] text-[var(--tf-faint)]'>
        {props.label}
        {props.tag && <GiftTag>{props.tag}</GiftTag>}
      </div>
      {props.children}
      {props.cap && (
        <div className='mt-2 text-[11.5px] leading-[1.5] text-[var(--tf-faint)]'>
          {props.cap}
        </div>
      )}
    </div>
  )
}

export function PricingCard(props: {
  tier: PricingTier
  onCta: (planId?: number) => void
  /** 已登录且持有同级/更高生效套餐时置灰(与充值页「不可降级」同一规则) */
  disabled?: boolean
  /** 高级精细调度是否可用(最低档不支持，其余限时开放) */
  fineSched?: boolean
}) {
  const { tier } = props
  const accent = Boolean(tier.recommended)
  // 基础额度 '500 万 token' → 数值大字 + token 小字(对齐参考稿 pblock-val small)
  const baseVal = tier.baseTokens?.replace(/\s*token\s*$/, '') ?? null
  // 高级额度超出售价的部分是白送的 → 「赠送 ¥X」徽章(参考稿 gift-tag)
  const advancedBonus =
    tier.advancedCredit > 0
      ? Number((tier.advancedCredit - tier.price).toFixed(1))
      : 0

  return (
    <div
      className={`relative flex h-full flex-col rounded-2xl bg-[var(--tf-surface)] px-[22px] pt-7 pb-6 shadow-[0_1px_2px_rgba(15,23,42,.05)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_1px_3px_rgba(15,23,42,.05),0_8px_30px_rgba(15,23,42,.06)] ${
        accent
          ? 'border-[1.5px] border-[var(--tf-pos)] shadow-[0_10px_36px_rgba(37,107,251,.10)]'
          : 'border border-[var(--tf-line)]'
      }`}
    >
      {accent && (
        <span className='absolute -top-[13px] left-1/2 -translate-x-1/2 rounded-full bg-[var(--tf-pos)] px-3.5 py-1 text-[12px] font-semibold whitespace-nowrap text-white'>
          推荐
        </span>
      )}

      <h3
        className='text-[16px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
        style={DISPLAY}
      >
        {tier.name}
      </h3>
      <p className='mt-1.5 min-h-[36px] text-[12.5px] leading-[1.5] text-[var(--tf-faint)]'>
        {tier.tagline}
      </p>

      {/* 价格：¥X + 小字周期(shrink-0 + nowrap 防被宽价格挤压折行) */}
      <div className='mt-3.5 flex items-baseline gap-1'>
        <span
          className='text-[34px] leading-none font-bold tracking-[-0.02em] whitespace-nowrap text-[var(--tf-ink)] tabular-nums'
          style={DISPLAY}
        >
          ¥{tier.price}
        </span>
        <span className='shrink-0 text-[13px] whitespace-nowrap text-[var(--tf-faint)]'>
          / 30 天
        </span>
      </div>

      {/* 调度配额 */}
      <PBlock label='调度配额' hot={accent}>
        <div className='flex items-center justify-between gap-2 pt-2 pb-[7px] text-[13px]'>
          <span className='text-[var(--tf-muted)]'>高效调度</span>
          <span className='font-semibold whitespace-nowrap text-[var(--tf-ink-2)]'>
            不限量
          </span>
        </div>
        <div className='flex items-center justify-between gap-2 border-t border-dashed border-[var(--tf-line-2)] py-[7px] text-[13px]'>
          <span className='text-[var(--tf-muted)]'>高级精细调度</span>
          {props.fineSched ? (
            <span className='font-semibold whitespace-nowrap text-[var(--tf-pos)]'>
              ✓ 限时支持
            </span>
          ) : (
            <span className='whitespace-nowrap text-[var(--tf-faint)]'>
              不支持
            </span>
          )}
        </div>
        <div className='text-[11.5px] leading-[1.5] text-[var(--tf-faint)]'>
          {props.fineSched
            ? '两种模式可随时切换'
            : '高效调度不限量，满足日常使用'}
        </div>
      </PBlock>

      {/* 高级模型额度 */}
      <PBlock
        label='高级模型额度'
        tag={advancedBonus > 0 ? `赠送 ¥${advancedBonus}` : undefined}
        hot={accent}
        cap='国产旗舰模型，按官方价扣减'
      >
        <div
          className='mt-1.5 text-[23px] leading-[1.15] font-bold tracking-[-0.02em] text-[var(--tf-ink)] tabular-nums'
          style={DISPLAY}
        >
          {tier.advancedCredit > 0 ? `¥${tier.advancedCredit}` : '无限量'}
        </div>
      </PBlock>

      {/* 基础模型额度 */}
      <PBlock
        label='基础模型额度'
        tag={baseVal !== '—' ? '赠送' : undefined}
        hot={accent}
        cap='自部署模型，按 Token 扣减'
      >
        <div
          className='mt-1.5 text-[23px] leading-[1.15] font-bold tracking-[-0.02em] text-[var(--tf-ink)] tabular-nums'
          style={DISPLAY}
        >
          {baseVal === null ? (
            '无限量'
          ) : baseVal === '—' ? (
            '—'
          ) : (
            <>
              {baseVal}
              <small className='text-[13.5px] font-medium text-[var(--tf-muted)]'>
                {' '}
                token
              </small>
            </>
          )}
        </div>
      </PBlock>

      <div className='flex-1' />

      {props.disabled ? (
        <button
          type='button'
          disabled
          title='已持有同级或更高的生效套餐'
          className='mt-4 inline-flex h-[46px] w-full cursor-not-allowed items-center justify-center rounded-[10px] border border-[var(--tf-line)] bg-transparent text-[15px] font-medium text-[var(--tf-faint)]'
        >
          不可降级
        </button>
      ) : (
        <button
          type='button'
          onClick={() => props.onCta(tier.planId)}
          className={`mt-4 inline-flex h-[46px] w-full items-center justify-center rounded-[10px] text-[15px] font-medium transition-[background,transform,border-color] duration-200 hover:-translate-y-px ${
            accent
              ? 'border border-transparent bg-[var(--tf-pos)] text-white hover:brightness-110'
              : 'border border-[var(--tf-line-2)] bg-transparent text-[var(--tf-ink)] hover:border-[var(--tf-ink)]'
          }`}
        >
          立即开通
        </button>
      )}
    </div>
  )
}

/**
 * 取公开套餐，失败或为空时回落到静态兜底。营销页无鉴权，拿不到就不该白屏。
 */
export function usePublicPlanTiers(): PricingTier[] {
  const [tiers, setTiers] = useState<PricingTier[]>(PRICING_TIERS)
  useEffect(() => {
    api
      .get('/api/subscription/public_plans')
      .then((res) => {
        const mapped = plansToTiers(res.data?.data || [])
        if (mapped.length > 0) setTiers(mapped)
      })
      .catch(() => {})
  }, [])
  return tiers
}
