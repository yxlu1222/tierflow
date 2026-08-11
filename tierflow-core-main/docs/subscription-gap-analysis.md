# 订阅套餐系统 · 现状与目标差距分析

> 2026-07-19 · 基于五路并行代码调研 + 关键事实逐条复核(所有 file:line 均已验证)。
> 目标设定见下文 §1,由产品拍板于 2026-07-19。
>
> **实施状态(2026-07-19):P0–P5 全部完成**,提交序列 c556a6eb(P0)→
> 479fe4b8(P1)→ c087c375(P2)→ cde33b2d(P3)→ 2351be5e(P4)→ P5。
> §3 各项差距均已落地;本文其余部分保留为设计依据与调研存档,行号以
> 当时代码为准。**全链路验收通过**(dev 实测):建 set→建双桶套餐→余额
> 购买→自动发 Key→basic 模型扣 token 桶(按真实用量)→premium 模型扣
> quota 桶→钱包全程隔离;余额不足正确拒绝。
> **升级 HTTP 链路实测**:报价(剩余价值全额抵扣)→补差扣款→旧订阅
> cancelled/旧 Key 禁用→新订阅 source=upgrade/新 Key 签发→订单可追溯。
> **P4 门禁三分支实测**(临时 BASIC_MODEL_CONTEXT_SWITCH=50):
> A 超上下文+premium 有余→强切 premium set(扣 quota 130);
> B 超上下文+premium 空→403 定制文案,OpenAI 与 /v1/messages 双格式正确;
> C 短上下文+premium 空→降级 basic set,请求成功按 token 扣 24
> (「降级不失败」承诺成立)。
> **遗留小项**:合规未确认时用户端订阅卡片静默隐藏(现状可接受:有
> 历史订阅的用户卡片仍渲染);duration 表单默认已改 day/30 但未硬性
> 禁用其他选项(编辑存量套餐需要);D12 用户协议条款**已起草并写入**
> `/user-agreement` 第三章第 5–9 条(30 天有效期、到期清零、双桶与
> 余额隔离、专用 Key、升级折算、无限量合理使用限制),措辞可由产品
> 终审修订。

---

## 1. 目标设定(已拍板)

一个套餐 = **两个独立额度桶**:

| 桶 | 计量 | 扣费规则 |
|---|---|---|
| 高级模型桶 | 人民币额度 | 每次调用按**售卖价**扣钱 |
| 基础模型桶 | token 总量(高档位无限) | 每次调用按 token 数扣 |

- 走高级/基础由 TierFlow 路由**自动决定**,用户不可选;早期只有**一个**基础模型
- 高级额度不足以覆盖本次调用 → **降级基础模型**,请求不失败
- 上下文 > **256k**(基础模型上限)且高级桶有额度 → 切高级模型;高级桶空 → 报错「高级模型额度用完了,超出基础模型上下文,请重开窗口」
- 两桶皆空 → 「用量达到套餐上限,已失效」,**不回落钱包**
- 有效期统一 **30 天**(自购买日起),到期两桶清零、不结转不退款;须写进用户协议
- 套餐绑定**专用 API Key**,与钱包余额完全隔离
- 升级:剩余价值 = `套餐价 ÷ 30 × 剩余天数`,补差价
- 无限量档服务边界(内部参数,**不上营销页**):256k 上下文 · 2 RPM

四档定价(档位名为占位,未确认):

| | 入门 ¥9.9 | 进阶 ¥39.9 | 专业 ¥69.9 | 旗舰 ¥149.9 |
|---|---|---|---|---|
| 高级额度 | ¥9.9 | ¥39.9 | ¥99.9 | ¥199 |
| 基础模型 | 500 万 token | 1800 万 token | 无限 | 无限 |

---

## 2. 现状架构摘要

### 2.1 数据模型(`model/subscription.go`)

- `SubscriptionPlan`(:146-180):**单桶** `TotalAmount int64`(:172,quota 单位,0=无限)+ `DurationUnit/Value/CustomSeconds` + `QuotaResetPeriod` + `UpgradeGroup` + `MaxPurchasePerUser`。`Currency` 字段存在但被 controller **强制覆写 "USD"**(controller/subscription.go:165/167/235/237)。
- `UserSubscription`(:240-262):`AmountTotal/AmountUsed` 快照 + 起止时间 + `UpgradeGroup/PrevUserGroup`。**没有价格快照**。
- `SubscriptionOrder`(:201-215):**没有 `user_subscription_id`**,升级订单无法追溯目标订阅。
- `SubscriptionPreConsumeRecord`(:1021-1030):`request_id` 唯一索引 = 幂等闸。
- 额度单位 = 内部 quota(`QuotaPerUnit = 500000`,即 1 USD;common/constants.go:42)。**模型层零 CNY 概念**。

### 2.2 计费链路

```
TokenAuth → ModelRequestRateLimit → AutoRoute(路由决策) → Distribute(选渠道)
  → controller.Relay → EstimateRequestToken(:147) → ModelPriceHelper(:155)
  → PreConsumeBilling(:166) → 转发 → PostConsume 结算
```
(router/relay-router.go:64-79、controller/relay.go)

- 资金源由**用户级** `BillingPreference` 决定(service/billing_session.go:344),四值:`subscription_first(默认)/wallet_first/subscription_only/wallet_only`。
- `PreConsumeUserSubscription(requestId, userId, modelName, quotaType, amount)`(model/subscription.go:1081):**`modelName`/`quotaType` 是死参数,函数体未使用**(已验证)——恰是"按模型分桶"所需入参,接入点现成。
- 扣费按 `end_time asc` 遍历所有 active 订阅,单订阅扣,不拆分。
- 订阅错误是裸字符串,`billing_session.go:213-217` 用 `strings.Contains` 压成通用 `ErrorCodeInsufficientUserQuota`(代码内有 TODO 要求改哨兵错误)。

### 2.3 关键既有能力(可复用)

| 能力 | 位置 | 备注 |
|---|---|---|
| Token 独立额度账本 | model/token.go(remain/used/unlimited/expired) | 与钱包完全隔离,天然适配"套餐专用 Key" |
| 注册自动发 Key | controller/user.go:200-227 | "套餐发 Key"可直接抄的模板 |
| 按 group 限流覆盖表 | setting/rate_limit.go:38 `ModelRequestRateLimitGroup` | `{"组名": [总数, 成功数]}`,套餐→group→限流链路通 |
| 模型组→渠道白名单 | model/model_group.go → ContextKeyAllowedChannelIds → distributor.go:134 | 建 basic/premium 两组零成本 |
| 路由档位 + 多模态兜底 | model/routing_profile.go(tier1-5 + MultimodalModel)、middleware/auto_route.go:80-82 | "长上下文兜底"可完全同构复制 |
| 订单状态机 + 幂等 | LockOrder + CompleteSubscriptionOrder(FOR UPDATE + PaymentProvider 校验) | 升级订单可复用骨架 |
| 30 天表达 | `duration_unit='day' + value=30`(calcPlanEndTime :293,精确 30×24h) | **零改动** |
| 计费表达式长上下文分档 | pkg/billingexpr `len` 变量 + `tier()` | 计价侧已完备,只是不参与路由 |

---

## 3. 逐项差距

### 3.1 双桶额度 —— 🟡 中

**缺**:
1. Plan 加第二桶字段(总量 + 单位标识 + 各自重置周期)。⚠️ `0=无限` 语义已被单桶占用,新桶必须用 `-1` 或显式 bool。
2. `UserSubscription` 加第二对 total/used + 第二组 reset 时间 + **价格快照**(§3.6 依赖)。
3. `PreConsume/Refund/PostConsume/maybeReset` 四函数按桶拆;`RelayInfo` 的 `SubscriptionId/PreConsumed/...` 单桶标量(relay/common/relay_info.go:132-145)要改结构。
4. 额度告警 `checkAndSendSubscriptionQuotaNotify`(service/quota.go:505)按桶分拆,token 桶不能用 quota 阈值。
5. 无限桶与 `subConsume >= 1` 强制预扣的交互(billing_session.go:377-379):无限桶下会持续累加 AmountUsed,会计不准,需单独处理。
6. 基础桶按 token 计量:PreConsume 阶段只有估算 token,需预扣估算值 + 结算补差(现有钱包路径同模式,可照抄)。

**修**:`RefundSubscriptionPreConsume` 嵌套事务(外层 :1189 事务内调用 :1300 又开全局 DB 事务)——多桶下风险放大,先改为传 tx。

### 3.2 30 天有效期 —— 🟢 零后端改动

- `day/30` 已是精确 30×24h。管理端应**禁用 `month`**(自然月,1/31+1月→3/3)。
- 30 天套餐若要周期内重置,只能 `custom+2592000`;`monthly` 是下月 1 号对齐,与购买日锚定不符。
- 到期处理现状:`ExpireDueSubscriptions` **不清零余额**,只置 `status='expired'` 靠查询条件屏蔽——效果等价于清零,无需改。

### 3.3 套餐专用 API Key —— 🟡 中

**缺**:
1. `tokens` 表加 `user_subscription_id`(已验证现无任何订阅字段)。⚠️ 同步五处:struct、`Update()` Select 白名单(model/token.go:297)、controller cleanToken、`SetupContextForToken`、Redis 缓存版本失效。
2. 四条订阅创建路径(CompleteSubscriptionOrder / PurchaseSubscriptionWithBalance / AdminBind / CreateUserSubscriptionFromPlanTx)挂钩自动发 Key;`expired_time` 对齐订阅 `EndTime`。
3. **生命周期联动全缺**:订阅过期/作废/删除均不禁用 Key、不清缓存。
4. 资金源判定是**用户级**非 Key 级:`NewBillingSession` 需加"key 绑定订阅则强制走该订阅"分支;`PreConsumeUserSubscription` 签名需加 `subscriptionId` 定向参数。
5. `GetMaxUserTokens()` 上限会把系统发的 Key 计入用户配额,需豁免。
6. 前端:购买成功展示/复制 Key(现在只 toast);keys 列表加"来源=套餐"徽标 + 只读保护。
7. ⚠️ per-key 绑定与全局 `billing_preference` Select(recharge 页约 75 行)语义冲突,需决策去留(§6 D10)。

### 3.4 额度感知路由 + 256k 切换 —— 🔴 高(唯一架构级障碍)

**根因**:路由决策(AutoRoute)在中间件层,而它需要的三样东西全在其后:

| 需要 | 产生位置 | 相对 AutoRoute |
|---|---|---|
| 订阅剩余额度 | 仅在 PreConsume 事务内被读 | 晚(且从未进 context) |
| 请求 token 数 | controller/relay.go:147 | 晚一层 |
| 本次调用价格 | controller/relay.go:155 | 更晚 |

- AutoRoute 的 `extractRoutingSlices` 只取尾窗 8 条 × 4096 字符,**刻意丢信息**,不可判长度。
- tokenizer 成本硬约束:OpenAI 系 tiktoken BPE,256k≈1MB 文本,**数百毫秒独占一核** + 全量 strings.Join 的 GC 压力。在 AutoRoute 重复计算会使首 token 延迟翻倍。
- 非 OpenAI 模型走字符权重估算,误差 5-15%,256k 硬阈值不稳。
- 事前 `Len` = 估算 promptTokens,**不含 cache read/creation**(relay/helper/price.go:199)——Claude 长会话严重低估,该切没切。
- 错误格式:AutoRoute 只会输出 OpenAI 格式错误体(abortWithOpenAiMessage),relay 层才分 OpenAI/Claude/Realtime 三格式——Claude 端点在中间件报错会拿到错格式。
- **新发现**:WebSocket/realtime 路径(relay-router.go:69-75)**不挂 AutoRoute**,降级/256k 逻辑天然覆盖不到实时端点。
- 哨兵错误缺失:三处裸 error(model/subscription.go:1122/1125/1176),无法区分「没订阅/高级额度尽/超基础上下文」三种情况 → 目标错误文案无法返回。

**推荐方案(两级判定)**:AutoRoute 内先用 `len(body)` 字节数**粗筛**(零成本);仅阈值附近请求做精确 token 计算并写入 `ContextKeyPromptTokens` 供下游复用;阈值留缓冲带(如 >240k 即切)。订阅余额做只读查询 + 短 TTL 缓存写进 context(挂 `SetupContextForToken` 之后)。

**插入点清单**:auto_route.go:86(ResolveModel 后)加额度门禁;:80 旁加长上下文兜底(与多模态兜底同构);routing_profile 加 `LongContextModel/LongContextThreshold` + 高级档标记;RecordRouteDecision 加降级原因;log_info_generate 记录降级。

### 3.5 2 RPM 限速 —— 🟡 中

**通路已存在**:套餐 `UpgradeGroup` → users.group → `ModelRequestRateLimitGroup{"组名":[0,2]}` + `DurationMinutes=1`。

**缺/坑**:
1. **粒度只到 group,不到模型**:限流中间件在 AutoRoute **之前**(relay-router.go:65 vs :78),此刻不知最终模型 → 做不到"仅基础模型限 2 RPM"(§6 D3)。
2. LIST 滑动窗口**非原子**(LLEN→LINDEX→LPUSH 分离),2 RPM 极小配额下并发超发误差最大,2 变 4 很容易 → 应改 lua 原子实现。
3. lua 令牌桶 `EXPIRE` 被注释(common/limiter/lua/rate_limit.lua 末尾,已验证),桶 key 永不过期,Redis 内存泄漏。
4. `limiter.New` 的 `sync.Once` + `EvalSha`:Redis 重启丢脚本后永久 NOSCRIPT,无 Eval fallback。
5. 无 `Retry-After`/`X-RateLimit-*` 头 —— 2 RPM 下 Claude Code/Codex 无法优雅退避,体验硬伤。
6. 内存路径限流退化为裸 429 无 body;文案硬编码中文;i18n key 已定义从未接线。

### 3.6 升级补差价 —— 🔴 缺口最大(全新功能)

1. **价格快照缺失**:折算公式的分子只能现查 `plan.price_amount`,而价格可改且无版本化 → 用户按旧价买、按新价折算,凭空多退。必须在 `UserSubscription` 存 `paid_money`。
2. `SubscriptionOrder` 加 `user_subscription_id` + `order_type(new/upgrade)`。
3. 无档位序号:`sort_order` 仅展示用,需 `tier int` 判定升级方向。
4. 旧订阅终止逻辑无先例:`AdminInvalidate` 会触发分组回退——升级场景是**错误行为**,需跳过降级的变体。
5. `MaxPurchasePerUser` 计数**含已过期订阅**(终身上限),`max=1` 套餐升级会被拒 → 需 `source='upgrade'` 豁免。
6. `prev_user_group` 是单值快照,多级升级链无人维护,退订回退目标可能错。
7. 差价为负(降级)无处理——建议 V1 明确**只支持升不支持降**。
8. 时间基准:折算须用 `GetDBTimestamp()`(DB 时钟),现有代码 DB/进程时钟混用,新逻辑要统一。

### 3.7 人民币展示 —— 🟡 低(但铺得广)

- 后端 `Currency` 写死 "USD" 四处(已验证);前端套餐价格三处硬编码 `$`(subscription-plans-card:554、purchase-dialog:223、subscriptions-columns:190),不走 currency 格式化。
- 额度展示 `formatQuota` 已支持按系统配置渲染 USD/CNY/tokens,可复用。
- **推荐**:模型层保持 quota 计量,仅 UI 层经 `USDExchangeRate` 换算展示 CNY(§6 D1)。

---

## 4. 实现陷阱(静默出错类)

1. **Plan 加字段改 4 处**:struct、SQLite CREATE TABLE(model/main.go:568-590)、SQLite required 列清单(:604-620)、controller updateMap(controller/subscription.go:270-286)。漏 SQLite 两处**不报错,静默缺列**。
2. `UserSubscription` 加字段走 AutoMigrate 即可(两处注册点均已含)。
3. SQLite 下 `FOR UPDATE` 是 no-op —— 并发扣费正确性仅在 MySQL/PG 成立。
4. Token 加字段必须同步 `Update()` Select 白名单,否则永远写不进。
5. `PostConsumeUserSubscriptionDelta` 无幂等(纯增量),靠调用路径唯一性保证 —— 多桶改造时别引入第二个调用点。
6. 结算超额静默失败:`newUsed > AmountTotal` 报错只被 LogError 吞掉,用超部分不扣(service/text_quota.go:374-376)。
7. 定时任务仅 master 节点 + 进程内 CAS,**无分布式锁**。

## 5. 顺带发现的现成 Bug(建议随手修)

| Bug | 位置 |
|---|---|
| 余额购买订阅不写 TopUp,账单页完全看不到 | model/subscription.go:690 分支缺 upsertSubscriptionTopUpTx |
| ePay 订阅订单 Amount 写 0,账单金额显示 0 | model/subscription.go:604 vs billing-orders 取 amount 列 |
| 合规未确认时用户端订阅卡片静默消失零提示 | subscription-plans-card.tsx:234 |
| 管理端 price_amount 无 9999 上限校验(后端会拒) | plan-form.ts vs controller/subscription.go:160 |
| 内存限流路径裸 429 无 body | middleware/model-rate-limit.go:139,148 |
| 限流 i18n key 定义了从未使用,total_reached 缺译文 | i18n/keys.go:231-232 |

## 6. 实施路线(按依赖排序)

```
P0 地基:哨兵错误 + 专用 ErrorCode;Refund 嵌套事务修复          ← 一切的前提
P1 双桶数据模型:字段 ×4处迁移;四函数按桶拆;RelayInfo 结构化    ← 依赖 P0
P2 模型分类:basic/premium 标记落地(方式待 D2)                  ← P1 的语义前提
P3 专用 Key:token 关联 + 发 Key 挂钩 + 生命周期联动 + 计费定向   ← 依赖 P1
P4 额度感知路由 + 256k:context 注入余额;两级长度判定;降级门禁   ← 依赖 P0-P3,最难
P5 限速(lua 原子化 + EXPIRE 修复)、升级补差价、前端接线、CNY 展示
```

P1-P3 完成后即可**人工开卡试运营**(管理员绑套餐 + 发 Key),P4 上线前"降级"可先降级为"直接拒绝",保底可用。

---

## 7. 决策清单(2026-07-19 已过一轮拍板)

### 7.1 已定

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 货币 | **方案甲**:内部 quota 锚不动,展示与录入统一 CNY(录入 ¥ 按固定汇率换算成 quota 存储);**前端删币种选择 UI、后端删币种选项、数据库删 `subscription_plans.Currency` 列**(迁移 DROP,SQLite 用重建表或忽略旧列)。`price_amount` 语义唯一锚定人民币——价格成为不可配置、无歧义的单一原语。牵连见 §7.3 |
| D2 | 基础/高级模型怎么标 | **新增一层「套餐模型组」**:一个套餐模型组包含多个现有模型组(一个模型组 = 不同上游提供的同一模型)。套餐的高级/基础桶各指向一个套餐模型组。见 §7.4 |
| D3 | 2 RPM 粒度 | 按推荐:V1 整套餐统一限速(套餐→group→`ModelRequestRateLimitGroup`),不分模型 |
| D4 | 256k 判定 | 按推荐:字节数粗筛 + 阈值附近精算,留缓冲带(>240k 即切) |
| D5 | 降级决策位置 | 按推荐:中间件内注入订阅余额/长度,不动路由位置 |
| D7 | 档位名 | **Lite / Standard / Pro / Max**(前端 /pricing 已更新) |
| D10 | 升级方向 | **只能升级,不能降级** |
| D11 | realtime 端点 | 按推荐:V1 明确不支持,文档写清 |
| D6 | Standard ¥39.9 被 Pro 支配 | **有意为之,保持现设计**(锚定档,衬托 Pro;产品已知晓算术关系并确认) |
| D8 | 无限桶取值 | **-1 = 无限,0 = 无额度,正数 = 具体量** |
| D9 | 资金源判定 | **改为 Key 决定,废弃用户级偏好**:套餐专用 Key → 只走该套餐双桶;普通 Key → 只走钱包余额,互不干扰。存量老用户只有余额(无历史订阅),`BillingPreference` 四值机制(subscription_first 等)连同 recharge 页的偏好选择器一并移除。`NewBillingSession` 的资金源 switch 简化为"看 key 上有无 user_subscription_id" |

### 7.2 待展开讨论

| # | 决策点 | 状态 |
|---|---|---|
| D12 | 用户协议条款 | **已起草写入** /user-agreement 三之 5–9 条(30 天/清零/双桶隔离/专用 Key/升级折算/合理使用限制);措辞待产品终审 |

### 7.3 D1「写死人民币」的实施牵连(重要)

内部 quota 单位在数学上锚定美元(`QuotaPerUnit = 500000` = $1,common/constants.go:42),且 billingexpr 表达式的系数约定是 **$/1M tokens**(pkg/billingexpr/expr.md)。「全局写死人民币」有两种落法:

- **方案甲(推荐)**:内部 quota 锚不动,所有**展示与录入**层统一 CNY——`quotaDisplayType` 写死 CNY、`price_amount` 语义改为人民币、录入价格时按固定汇率(现 `USDExchangeRate=7.3`)换算成 quota、删除币种选择 UI。改动集中在边界层,billingexpr 与既有定价数据不动。
- **方案乙**:把 quota 锚直接改成人民币(1 quota 单位 = ¥X)。所有模型倍率、billingexpr 表达式系数、渠道成本配置**全部要按 CNY 重新录入**,历史计费数据量纲断裂。工程量大、风险高,不推荐。

余额支付换算点 `calcSubscriptionBalanceQuota = price × QuotaPerUnit`(model/subscription.go:675)隐含 price 为美元——方案甲下此处必须除以汇率,否则 ¥9.9 会按 $9.9 扣。

### 7.4 D2「套餐模型组」概念设计(待细化)

```
套餐 Plan
 ├─ 高级桶 → 套餐模型组 premium_set ─┬─ 模型组 A(GPT5.5 × N 上游)
 │                                   ├─ 模型组 B(GLM5.2 × N 上游)
 │                                   └─ ...
 └─ 基础桶 → 套餐模型组 basic_set  ──└─ 模型组 X(基础模型 × N 上游)
```

- 现有 `ModelGroup`(model/model_group.go)语义 =「同一模型的上游花名册」,保持不动。
- 新实体(暂名 `PlanModelSet`):`id/name/description` + 成员表 `plan_model_set_members(set_id, model_group_id)`。
- `SubscriptionPlan` 增加 `premium_set_id` / `basic_set_id`。
- 路由/计费判断「该模型属于哪个桶」= 模型 → 所属模型组 → 所属套餐模型组 → 桶。需要一个带缓存的反查(model_group_id → set_id)。
- 管理端需要新的 CRUD 页面(可抄 model-groups 的骨架)。

---

*本文档由代码调研生成,实现前请以最新代码为准;所有行号基于 feat/subscription-plans @ 48f923ec 附近。*
