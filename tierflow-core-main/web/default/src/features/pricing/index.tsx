/*
Copyright (C) 2023-2026 TierFlow
*/
/**
 * 套餐方案独立页(/pricing)—— 首页之外唯一展示价格的地方。
 * 排版与文案对齐 pricing.html 参考稿：page-hero + 调度图例 + 三 pblock 定价卡
 * + 高级模型阵容(mm-grid)+ 两种调度模式(mode-grid)+ FAQ + CTA band；
 * 并按项目实际情况适配：
 * 价格数据仍走 /api/subscription/public_plans(usePublicPlanTiers，含静态兜底)、
 * 登录态低/平级套餐置灰(getPlanPurchasability)、升级 FAQ 反映补差价能力。
 * 配色走 `.tf-landing` 作用域 token(--tf-*)，全站仅亮色主题，不引入 `dark:`。
 */
import { useEffect, useState } from 'react'
import { DeepSeek, Moonshot, Qwen, Zhipu } from '@lobehub/icons'
import { useNavigate } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { AnimateInView } from '@/components/animate-in-view'
import {
  CONTAINER,
  DISPLAY,
  DOCS_URL,
  GhostLink,
  PrimaryButton,
} from '@/components/landing-kit'
import { PublicLayout } from '@/components/layout'
import { getSelfSubscriptionFull } from '@/features/subscriptions/api'
import {
  getPlanPurchasability,
  partitionSubscriptions,
} from '@/features/subscriptions/lib/selectors'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { PricingCard, usePublicPlanTiers } from './plan-cards'

// 高级模型阵容(参考稿 mm-grid)：静态营销内容，价格为对外口径
const PREMIUM_MODEL_CARDS = [
  {
    name: 'GLM5.2',
    vendor: '智谱',
    fit: '综合均衡，通用任务稳定之选',
    input: 8,
    output: 28,
    Icon: Zhipu.Color,
  },
  {
    name: 'Kimi K3',
    vendor: '月之暗面',
    fit: '长上下文与复杂推理见长',
    input: 20,
    output: 100,
    // 月之暗面品牌标(Moonshot 无彩色变体，单色即品牌色)
    Icon: Moonshot,
  },
  {
    name: 'DeepSeek V4 Pro',
    vendor: '深度求索',
    fit: '代码与数学任务强项',
    input: 3,
    output: 6,
    Icon: DeepSeek.Color,
  },
  {
    name: 'Qwen 3.7 Max',
    vendor: '阿里通义',
    fit: '多语言与指令遵循出色',
    input: 12,
    output: 36,
    Icon: Qwen.Color,
  },
]

// FAQ：参考稿三问 + 项目实际的升级/额度隔离两问
const FAQS = [
  {
    q: '套餐有效期多久？会自动续费吗？',
    a: '每个套餐有效期 30 天，不自动续费，到期后需手动续订或更换套餐。到期后未用完的高级模型额度与基础模型 token 一并清零。',
  },
  {
    q: '高级模型额度用完了会怎样？',
    a: '系统会自动降级为基础模型继续服务，不中断、不报错。充值任意套餐即可恢复高级模型调度。',
  },
  {
    q: '高效调度和高级精细调度可以随时切换吗？',
    a: '可以。两种模式在接入配置中随时切换，按次生效，互不影响配额。',
  },
  {
    q: '中途可以升级吗？',
    a: '可以。当前套餐的剩余价值按「套餐价格 ÷ 30 × 剩余有效天数」折算，升级只需补差价，支持余额抵扣或在线支付。',
  },
  {
    q: '套餐额度和账户余额是分开的吗？',
    a: '是。套餐绑定一把专用 API Key，额度独立结算，不会串到账户钱包余额里。套餐用尽即失效，不会继续扣你的余额。',
  },
]

function SectionHead(props: {
  eyebrowB: string
  eyebrow: string
  h2: string
  /** 标题下的说明段(参考稿 .section-head p)；可含加粗节点 */
  desc?: React.ReactNode
}) {
  return (
    <div className='mx-auto mb-9 max-w-[720px] text-center'>
      <span className='inline-flex items-center gap-2.5 text-[12px] font-medium tracking-[0.05em] text-[var(--tf-muted)]'>
        <b className='font-semibold text-[var(--tf-ink)]'>{props.eyebrowB}</b> /{' '}
        {props.eyebrow}
      </span>
      <h2
        className='m-0 mt-4 text-[clamp(30px,4vw,46px)] leading-[1.12] font-semibold tracking-[-0.025em] text-[var(--tf-ink)]'
        style={DISPLAY}
      >
        {props.h2}
      </h2>
      {props.desc && (
        <p className='m-0 mt-5 text-[clamp(16px,1.2vw,18px)] leading-[1.7] text-[var(--tf-muted)]'>
          {props.desc}
        </p>
      )}
    </div>
  )
}

function PricingPage() {
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const isLoggedIn = !!auth.user

  const tiers = usePublicPlanTiers()
  // 高级精细调度：最低档不支持，其余限时开放(对齐参考稿的档位梯度)
  const cheapestPrice = Math.min(...tiers.map((t) => t.price))

  // 已登录时拉取生效订阅，低/平级套餐置灰(与充值页/后端拦截同一规则)。
  // 未登录或接口失败静默跳过，不阻塞营销页展示。
  const [activeSubs, setActiveSubs] = useState<UserSubscriptionRecord[]>([])
  useEffect(() => {
    if (!isLoggedIn) return
    getSelfSubscriptionFull()
      .then((res) => {
        if (res.success && res.data) {
          const { active } = partitionSubscriptions(
            res.data.all_subscriptions || [],
            Math.floor(Date.now() / 1000)
          )
          setActiveSubs(active)
        }
      })
      .catch(() => {})
  }, [isLoggedIn])

  // 「立即开通」——已登录直达套餐订阅页(携带所选套餐，加载后自动弹购买框),
  // 未登录先注册
  const handlePlanClick = (planId?: number) => {
    if (!isLoggedIn) {
      navigate({ to: '/sign-up' })
      return
    }
    navigate({
      to: '/subscription',
      search: planId ? { plan: planId } : {},
    })
  }

  return (
    <div className='tf-landing relative overflow-x-clip'>
      {/* page-hero */}
      <section className='bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,rgba(37,107,251,.06),transparent_70%)] pt-[calc(64px+clamp(40px,6vw,80px))] pb-[clamp(36px,4.5vw,60px)] text-center'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <h1
              className='m-0 text-[clamp(34px,4.5vw,54px)] leading-[1.1] font-semibold tracking-[-0.035em] text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              为每一种用量，选好跑法
            </h1>
            <p className='mx-auto mt-[18px] max-w-[780px] text-[clamp(15px,1.2vw,17px)] leading-[1.75] text-[var(--tf-muted)]'>
              所有套餐默认走 TierFlow
              调度：调度到高级模型，按消耗扣除高级模型额度；调度到基础模型，只扣除基础模型
              Token 量。
              <b className='font-semibold text-[var(--tf-ink-2)]'>
                高级额度用尽后自动降级基础模型，服务不中断。
              </b>
            </p>
          </AnimateInView>
        </div>
      </section>

      {/* 定价卡 */}
      <section className='pt-[clamp(24px,3vw,40px)] pb-[clamp(48px,6vw,80px)]'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <div className='mx-auto mb-[26px] flex max-w-[860px] flex-wrap justify-center gap-x-[26px] gap-y-2 text-[12.5px] text-[var(--tf-muted)]'>
              <span>
                <b className='font-semibold text-[var(--tf-ink-2)]'>高效调度</b>{' '}
                · 高级模型额度消耗更慢，整体更省
              </span>
              <span>
                <b className='font-semibold text-[var(--tf-ink-2)]'>
                  高级精细调度
                </b>{' '}
                · BrainNet-8B 全程逐步精算，整体性能更强
              </span>
            </div>
          </AnimateInView>

          <div className='grid grid-cols-1 items-stretch gap-3.5 max-[980px]:gap-y-6 min-[600px]:grid-cols-2 min-[980px]:grid-cols-4'>
            {tiers.map((tier, i) => (
              <AnimateInView key={tier.key} animation='fade-up' delay={i * 80}>
                <PricingCard
                  tier={tier}
                  onCta={handlePlanClick}
                  fineSched={tier.price > cheapestPrice}
                  disabled={
                    isLoggedIn &&
                    activeSubs.length > 0 &&
                    // 静态兜底 tiers 无 planId，无法与订阅比对——此时不置灰，
                    // 否则用户自己持有的档位会被误判 blocked(renewable 判定靠 id)
                    tier.planId !== undefined &&
                    getPlanPurchasability(
                      { id: tier.planId, price_amount: tier.price },
                      activeSubs
                    ) === 'blocked'
                  }
                />
              </AnimateInView>
            ))}
          </div>

          <p className='mt-[22px] text-center text-[12.5px] text-[var(--tf-faint)]'>
            有效期 30 天，不自动续费 · 高级精细调度当前为限时开放权益
          </p>
        </div>
      </section>

      {/* 高级模型阵容(参考稿 mm-grid) */}
      <section className='bg-[var(--tf-surface-2)] py-[clamp(48px,6vw,80px)]'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <SectionHead
              eyebrowB='模型'
              eyebrow='高级模型'
              h2='国产旗舰，按消耗扣减'
              desc={
                <>
                  所有高级模型按官方价从额度扣减——
                  <b className='font-semibold text-[var(--tf-ink-2)]'>
                    没有溢价，还有赠送：高档位套餐的高级模型额度高于套餐价格，超出部分都是我们送的。
                  </b>
                </>
              }
            />
          </AnimateInView>
          <div className='grid grid-cols-1 gap-3.5 min-[600px]:grid-cols-2 min-[980px]:grid-cols-4'>
            {PREMIUM_MODEL_CARDS.map((m, i) => (
              <AnimateInView key={m.name} animation='fade-up' delay={i * 60}>
                <div className='h-full rounded-2xl border border-[var(--tf-line)] bg-[var(--tf-surface)] px-5 pt-5 pb-[18px] shadow-[0_1px_2px_rgba(15,23,42,.05)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_1px_3px_rgba(15,23,42,.05),0_8px_30px_rgba(15,23,42,.06)]'>
                  <div className='flex items-center gap-2.5'>
                    <m.Icon size={24} />
                    <div
                      className='text-[16.5px] font-semibold tracking-[-0.01em] text-[var(--tf-ink)]'
                      style={DISPLAY}
                    >
                      {m.name}
                    </div>
                  </div>
                  <div className='mt-2 text-[12px] text-[var(--tf-faint)]'>
                    {m.vendor}
                  </div>
                  <div className='mt-[7px] text-[12.5px] leading-[1.5] text-[var(--tf-muted)]'>
                    {m.fit}
                  </div>
                  <div className='mt-3.5 border-t border-dashed border-[var(--tf-line-2)] pt-3'>
                    <div className='flex items-baseline justify-between py-1 text-[13px] text-[var(--tf-muted)]'>
                      <span>输入</span>
                      <b className='font-semibold text-[var(--tf-ink-2)] tabular-nums'>
                        ¥{m.input.toFixed(1)} / M tokens
                      </b>
                    </div>
                    <div className='flex items-baseline justify-between py-1 text-[13px] text-[var(--tf-muted)]'>
                      <span>输出</span>
                      <b className='font-semibold text-[var(--tf-ink-2)] tabular-nums'>
                        ¥{m.output.toFixed(1)} / M tokens
                      </b>
                    </div>
                  </div>
                </div>
              </AnimateInView>
            ))}
          </div>
        </div>
      </section>

      {/* 两种调度模式(参考稿 mode-grid) */}
      <section className='py-[clamp(48px,6vw,80px)]'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <SectionHead
              eyebrowB='模式'
              eyebrow='两种调度'
              h2='省，还是强，你自己选'
              desc='接入时只需更换 model 名称，两种模式随时切换、按次生效。'
            />
          </AnimateInView>
          <div className='grid grid-cols-1 gap-3.5 min-[820px]:grid-cols-2'>
            <AnimateInView animation='fade-up'>
              <div className='h-full rounded-2xl border border-[var(--tf-line)] bg-[var(--tf-surface)] px-6 py-[26px] shadow-[0_1px_2px_rgba(15,23,42,.05)]'>
                <div
                  className='text-[17px] font-semibold text-[var(--tf-ink)]'
                  style={DISPLAY}
                >
                  高效调度
                </div>
                <p className='m-0 mt-2.5 text-[13.5px] leading-[1.7] text-[var(--tf-muted)]'>
                  轻量分流策略，优先把步骤派给高性价比模型——高级模型额度消耗更慢，整体成本更省。适合日常任务与成本敏感场景。
                </p>
                {/* mode-code：参考稿的深底代码块(全站 MiSans，不用等宽字体) */}
                <div className='mt-4 rounded-[9px] bg-[var(--tf-ink)] px-[15px] py-2.5 text-[12.5px] text-[#DDE3EC]'>
                  model: <b className='font-medium text-[#8FB6FF]'>"tierflow"</b>
                </div>
                <div className='mt-3.5 border-t border-dashed border-[var(--tf-line-2)] pt-3 text-[12.5px] text-[var(--tf-faint)]'>
                  全部套餐不限量
                </div>
              </div>
            </AnimateInView>
            <AnimateInView animation='fade-up' delay={80}>
              <div className='h-full rounded-2xl border-[1.5px] border-[var(--tf-pos)] bg-[var(--tf-surface)] px-6 py-[26px] shadow-[0_10px_36px_rgba(37,107,251,.10)]'>
                <div
                  className='text-[17px] font-semibold text-[var(--tf-pos)]'
                  style={DISPLAY}
                >
                  高级精细调度
                </div>
                <p className='m-0 mt-2.5 text-[13.5px] leading-[1.7] text-[var(--tf-muted)]'>
                  BrainNet-8B
                  全程逐步精算：任务理解、复杂度评估、上下文与记忆优化、成本预测逐步决策——整体性能更强。适合复杂任务与追求完成率的场景。
                </p>
                <div className='mt-4 rounded-[9px] bg-[var(--tf-ink)] px-[15px] py-2.5 text-[12.5px] text-[#DDE3EC]'>
                  model:{' '}
                  <b className='font-medium text-[#8FB6FF]'>"tierflow_pro"</b>
                </div>
                <div className='mt-3.5 border-t border-dashed border-[var(--tf-line-2)] pt-3 text-[12.5px] text-[var(--tf-faint)]'>
                  进阶版及以上
                </div>
              </div>
            </AnimateInView>
          </div>
        </div>
      </section>

      {/* FAQ —— 沿用旧版样式：左对齐标题 + 原生 details/summary 折叠行
          (键盘、读屏、Ctrl+F 页内查找都是浏览器自带行为，不必自己维护状态)
          灰底：与前后节保持灰/白交替 */}
      <section className='bg-[var(--tf-surface-2)] py-[clamp(64px,9vw,116px)]'>
        <div className={CONTAINER}>
          <AnimateInView animation='fade-up'>
            <h2
              className='m-0 max-w-[720px] text-[clamp(26px,3.4vw,40px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              购买之前，你可能想知道
            </h2>
          </AnimateInView>

          <div className='mt-9 max-w-[820px] border-t border-[var(--tf-line)]'>
            {FAQS.map((faq, i) => (
              <AnimateInView key={faq.q} animation='fade-up' delay={i * 60}>
                <details className='group border-b border-[var(--tf-line)]'>
                  <summary className='flex cursor-pointer list-none items-center justify-between gap-5 py-[18px] text-[16px] font-medium text-[var(--tf-ink)] transition-colors duration-150 hover:text-[var(--tf-pos)] [&::-webkit-details-marker]:hidden'>
                    <span style={DISPLAY}>{faq.q}</span>
                    <svg
                      aria-hidden='true'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth={2}
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      className='size-4 shrink-0 text-[var(--tf-faint)] transition-transform duration-200 group-open:rotate-180'
                    >
                      <path d='m6 9 6 6 6-6' />
                    </svg>
                  </summary>
                  <p className='m-0 pr-9 pb-[18px] text-[14.5px] leading-[1.7] text-[var(--tf-muted)]'>
                    {faq.a}
                  </p>
                </details>
              </AnimateInView>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band —— 白底收尾(接上灰底 FAQ)；给足高度并让内容垂直居中 */}
      <section className='flex min-h-[clamp(360px,48vh,520px)] items-center py-[clamp(48px,6vw,80px)] text-center'>
        <div className={`${CONTAINER} w-full`}>
          <AnimateInView animation='fade-up'>
            <h2
              className='m-0 text-[clamp(28px,3.6vw,42px)] leading-[1.12] font-semibold tracking-[-0.025em] text-balance text-[var(--tf-ink)]'
              style={DISPLAY}
            >
              选好套餐，让 TierFlow 接管下一次推理决策
            </h2>
            {/* 放宽到一行放得下的宽度；窄屏折行时用 text-balance 均分，避免孤字成行 */}
            <p className='mx-auto mt-5 max-w-[720px] text-[16px] leading-[1.7] text-balance text-[var(--tf-muted)]'>
              在生产智能体中接入
              TierFlow，为你的应用降低成本、提升完成率、保障稳定。
            </p>
            <div className='mt-8 inline-flex flex-wrap justify-center gap-3.5'>
              <PrimaryButton size='lg' onClick={() => handlePlanClick()}>
                获取 API Key
              </PrimaryButton>
              <GhostLink size='lg' href={DOCS_URL}>
                查看接入文档
              </GhostLink>
            </div>
          </AnimateInView>
        </div>
      </section>
    </div>
  )
}

export function Pricing() {
  return (
    <PublicLayout showMainContainer={false}>
      <PricingPage />
    </PublicLayout>
  )
}
