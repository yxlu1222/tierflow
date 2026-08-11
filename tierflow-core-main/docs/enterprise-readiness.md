# 企业级就绪度评估 · 功能缺口与优先级

> 2026-07-24 · 基于全仓库代码勘查,结论以 file:line 或"全仓库无命中"的方式逐条落实。
> 本文只记录**已验证**的缺口:凡属推测的项目已在文中显式标注。
>
> 用法:§2–§4 按优先级分三梯队,每条给出证据、影响与落地建议;§5 是可勾选的进度表。
> 本文是评估存档,不是拍板决策——排期与取舍由产品确认后再动工。

---

## 1. 现有能力基线(已成熟,不建议重做)

评估的前提是先划清"已经做好的部分",避免把通用检查清单当成缺口:

| 域 | 现状 |
|---|---|
| 密钥治理 | `Token`(`model/token.go`)每 Key 独立额度、有效期、模型白名单(`ModelLimits`)、IP 白名单(`AllowIps`)、分组、套餐绑定(`UserSubscriptionId`) |
| 认证 | TOTP 2FA + 备份码、Passkey/WebAuthn、OAuth(GitHub/Discord/OIDC/LinuxDO/generic,见 `oauth/`)、邮箱验证、Turnstile |
| 限流 | 全局、按模型(`middleware/model-rate-limit.go`)、关键路径、邮件验证、搜索;订阅门禁 `middleware/subscription_gate.go` |
| 路由高可用 | 路由配置、渠道亲和、熔断冷却(见 `docs/high-availability-routing.md`)、渠道健康监控 |
| 计费深度 | 双桶订阅、表达式定价(`pkg/billingexpr/`)、上游成本入库(`Log.ProviderCost`)、毛利与财务看板 |
| 运营 | 工单系统、公告、双语 i18n(后端 go-i18n + 前端 i18next)、OpenAPI 文档(`docs/openapi/`) |
| 通知通道 | 邮件/Webhook/Bark/Gotify(`service/user_notify.go:51`)+ 频率限制(`service/notify-limit.go`);钱包余额阈值预警(`controller/user.go:1040-1041`) |

这些已达成熟产品水位。以下缺口均在此基线之上。

---

## 2. 第一梯队:便宜且确定(各 1–3 天,收益立即)

### 2.1 无优雅关闭 —— 每次发版掐断流式请求

**证据**:`main.go:180` 为裸 `server.Run(":" + port)`;全文件无 `signal.Notify` / `http.Server.Shutdown` / `SIGTERM` 处理。

**影响**:本项目是代理长连接 SSE 流的网关。进程被 kill 时所有正在输出的请求在中途断开,用户侧表现为响应截断。**每次部署/重启都会发生**,且随并发量线性放大。

**建议**:改用显式 `&http.Server{}`,捕获 SIGTERM/SIGINT → `Shutdown(ctx)` 排空(超时建议 30–60s,覆盖典型流式请求时长)→ 再关 DB/Redis。同时把 K8s/Docker 的 `stopGracePeriod` 调到大于该超时。

### 2.2 CI 不跑构建与测试

**证据**:`.github/workflows/` 下 5 个 workflow,其中 `pr-check.yml` 只有 anti-slop 的 PR 质量门禁(模板检查、屏蔽词、账号年龄、自动关闭);**没有任何 `go build`、`go test`、`tsc -b`、eslint 任务**。

**影响**:仓库已有可用的测试资产(`model/`、`controller/` 测试可全绿),但没有机制阻止回归合入 main。一次改坏 DDL 或类型的提交可以直接进主干。

**建议**:加一个 `build-test` job:`go build ./...` + `go vet ./...` + `go test ./...`,以及 `cd web/default && bun install && bun run typecheck && bun run lint`。设为 PR 必须通过。这是把已有投入变现,成本最低。

### 2.3 订阅到期完全静默,且无自动续费

**证据**:
- `model/subscription.go` 的 `ExpireDueSubscriptions`(由 `service/subscription_reset_task.go:57` 驱动)到期置 `expired` 并**同时禁用套餐专用 Key**(`DisableTokensBySubscriptionIdsTx`),全过程不触发任何通知。
- 续费能力实为"同套餐叠加续费"——守卫放行手动重新购买(`model/subscription.go:1049`),不存在自动扣费续订。
- 前端已对用户明示:`web/default/src/features/recharge/components/subscription-plans-card.tsx:439` 文案 `'Valid for {{duration}}, no auto-renewal'`。

**影响**:这是当前最大的收入漏斗缺口。30 天到期即死,完全依赖用户自己记得回来买;且到期瞬间专用 Key 被禁用,用户的线上集成在毫无预警下开始 401。

**建议**(基础设施已就位,无需新框架):
1. **到期提醒**(数小时):在 `subscription_reset_task.go` 同一循环里扫 `end_time` 落在 T-7/T-3/T-1 的 active 订阅,走 `NotifyUser` 发提醒;需要一张"已发送提醒"去重表或订阅上加标记位,避免重复轰炸。
2. **自动续费**(数天):订阅加 `auto_renew` 开关,到期前用钱包余额自动下单同套餐;余额不足则降级为提醒。注意与现有购买守卫(`checkActivePurchaseAllowedTx`)和购买上限的交互,以及必须复用订单幂等路径。

---

## 3. 第二梯队:企业成交的硬门槛

### 3.1 无管理员审计轨迹(优先级最高)

**证据**:`Log` 表(`model/log.go`)只有 `UserId`,**没有操作人字段**。管理员动作以散文形式写入**被操作用户**的日志,例如本次新增的 `AdminRefundTopUp`(回收用户额度)与 `AdminRefundSubscriptionOrder`(撤销订阅、退回钱包)都是 `RecordLog(order.UserId, ...)`。

**影响**:动钱的操作事后**查不出执行人**。同类无归属动作还包括:改用户额度、查看渠道密钥(`router/api-router.go:289`)、改定价、封禁用户、补单/作废。对外是 SOC2 / ISO 27001 的直接阻塞项;对内是"这笔退款谁批的、这个价谁改的"答不上来。

> 注:退款与额度回收功能已于 2026-07-24 上线,此缺口即时生效,建议优先于本梯队其它项处理。

**建议**:新增 `admin_audit` 表(操作人 id/用户名、动作、目标类型+id、前值、后值、IP、UA、时间),把 `c.GetInt("id")` 作为操作人贯穿到所有 `Admin*` 路径;后台加只读查询页(按操作人/动作/时间/目标检索)。审计写入不应因失败阻塞主流程,但需落 SysLog。

### 3.2 无发票 / 收据与账单导出

**证据**:全仓库 `invoice|发票` 仅命中散文——前端隐私政策文案与 `web/default/src/lib/currency.ts:385` 的注释;无相关数据模型、端点或 CSV/导出 controller。

**影响**:全站单币种人民币(CLAUDE.md Rule 8),意味着面向中国 B2B。**增值税发票是对公付款的成交前置条件**,不是加分项;财务对账也普遍要求可导出明细。

**建议**:最小可用版本 =(a)订单页"申请发票"入口,收集开票信息(名称/税号/地址/邮箱/类型),落一张 `invoice_request` 表并流转到管理端处理/回填发票号与附件;(b)账单与用量页加 CSV 导出。不需要自动开票对接,人工闭环即可解锁成交。

### 3.3 零可观测性

**证据**:业务代码零 `prometheus` / `opentelemetry` import,无 `/metrics` 端点。现有 route monitor 是自研且数据落业务库(`router/api-router.go:277` 的 `/health` 是渠道健康,非进程存活探针)。

> 降低成本的既有条件:`prometheus/client_golang v1.22.0` 已作为**间接依赖**存在于 `go.mod:116-119`(被其他库引入),接入 `promhttp` 无需引入并审查新依赖。

**影响**:无法接入 Grafana/告警体系;拿不到 p99 延迟、错误率 SLO、渠道失败率、上游成本异动。对外承诺 SLA 或做状态页都以此为前提(故状态页不单列)。也缺 K8s 用的 `/healthz` / `/readyz` 存活就绪探针。

**建议**:引入 `promhttp` 暴露 `/metrics`(仅内网或加鉴权),埋点覆盖:请求量/延迟直方图(按模型、渠道、分组)、错误与重试、渠道熔断事件、额度消耗与上游成本、订阅桶余额。同时补 `/healthz`(进程)与 `/readyz`(DB+Redis 可达)。

---

## 4. 第三梯队:架构与合规,按需排期

| # | 缺口 | 证据 | 说明与建议 |
|---|---|---|---|
| 4.1 | 无组织/团队/子账号 | 角色仅四档 `common/constants.go:171-174`(Guest/Common/Admin/Root),用户表扁平 | 一个登录 = 一个钱包。企业客户需要:单 billing 主体多席位、成员各自 Key、共享额度池、成员/部门级用量归集与权限。属改数据模型的大件,建议在有明确客户需求后启动 |
| 4.2 | 上游渠道密钥明文入库 | `common/` 下仅 `crypto.go`,且全 `common/` 树无 `aes.`/`cipher.`/`encrypt` 调用;`model/channel.go` 同样无加密 | 补偿控制是读取端点挂 RootAuth + 二次验证(`router/api-router.go:289`),但一份数据库备份即等于全部上游 Key 外泄。建议对 `channel.key` 做信封加密(KMS 或本地主密钥 + 环境变量),读取时解密 |
| 4.3 | 只有 AutoMigrate,无版本化迁移 | `model/main.go:207` → `migrateDB()`(:252)→ `DB.AutoMigrate`(:270) | 无迁移历史、无回滚路径。代码里已记录被 SQLite DDL 改写坑过(见 `UserSubscription.PaidMoney` 注释:`decimal(10,6)` 会触发 glebarez/sqlite 的 AlterColumn 逗号截断)。建议引入 golang-migrate 或 gormigrate,存量表以 baseline 方式纳管 |
| 4.4 | 日志表无自动保留/归档 | 仅 `controller/log.go:153` 的管理员手动 `DeleteHistoryLogs` | `logs` 是最大最热的表(每次 relay 一行),无定时清理、无冷热分离/分区。建议加可配置留存期的定时清理 + 归档到对象存储 |
| 4.5 | 无 PIPL/GDPR 数据生命周期 | 有 `DeleteSelf`,但无数据导出、无成文留存期 | 建议:用户自助"导出我的数据"、成文留存策略、删除时对日志做匿名化(保留计量、脱敏身份) |
| 4.6 | 仅支持预付 | 支付通道为易支付(其余网关已下线,见 `model/topup.go` 注释) | 企业采购常走不了预充值。需对公转账/后付费(net-30)、信用额度、PO 号。属商务流程配套,工作量取决于对账方式 |

**推测项(未验证需求,仅记录)**:SCIM 自动停权。OIDC 登录已覆盖大部分 SSO 场景,SAML/SCIM 建议等客户明确提出再评估,不预先投入。

---

## 4bis. 资金记账:推算 vs 记账(2026-07-25 代码审查发现)

管理端退款功能上线时暴露出一类共性问题:**退款金额靠事后推算,而不是落账时记录**。
两处都能自愈成"金额算错但流程报成功",属于最难发现的一类资金 bug。已修掉由此
引发的直接误导(余额单解析不到金额时改为拒绝退款,不再"退 0 报成功"),但根治
需要落列,故单列排期。

| # | 缺口 | 现状 | 建议 |
|---|---|---|---|
| 4.7 | 钱包退款的回收额度按**当前** `QuotaPerUnit` 反算 | `AdminRefundTopUp`(`model/topup.go`)用 `topUp.Amount × common.QuotaPerUnit` 推算当初发放量,而 `QuotaPerUnit` 是管理员可在运行时修改的选项(`model/option.go`)。改过汇率后退旧单,回收量与当初发放量不一致:调高会多扣(下取到 0,可能吃掉用户用别的充值买的额度),调低会少扣 | 给 `TopUp` 加 `CreditedQuota int64` 列,在 `EpayNotify` 与 `ManualCompleteTopUp` 发放时写入**实际发放量**;退款按该列扣。历史行为空时回退旧算法并在日志标注"按当前汇率估算"。AutoMigrate 加列、默认 0,无破坏性 |
| 4.8 | 余额订阅退款金额从**自由文本** `provider_payload` 字符串刮取 | `parseChargedQuota`(`model/subscription_order_admin.go`)按空格切分 payload 找 `charged_quota=` 前缀。该 payload 由两处独立 `fmt.Sprintf` 拼出(`model/subscription.go`、`model/subscription_upgrade.go`),本质是人类可读的审计备注 —— 改文案、旧数据、被回调覆盖、整数溢出都会让它解析失败 | 给 `SubscriptionOrder` 加 `ChargedQuota int64` 列,余额购买/余额升级落账时写入;退款读该列。`parseChargedQuota` 降级为仅历史数据兜底 |

### 升级单退款口径(已定:全额折现)

审查发现**升级单退款会吞掉源订阅的剩余价值**:升级时 `performUpgradeTx` 已作废源订阅,
其未消耗价值被折抵进这次升级;而退款只退差价,`remaining_value` 无人读取,那部分已付
价值凭空消失,且流程照样报成功。

**2026-07-25 拍板口径:全额折现** —— 不恢复源订阅(恢复需要原 `end_time`,而它已被
`performUpgradeTx` 覆写为 now,只能由 `remaining_value` 反推,带 `Ceil` 与两位小数的
舍入误差,不适合用来还原用户付过钱的到期时间),改为把「差价 + 被抵扣的剩余价值」
一并折成额度退回。已实现并有回归测试(`TestAdminRefundSubscriptionOrder_UpgradeRefundsRemainingValue`
断言退款后钱包回到「仅支出源套餐原价」的位置)。

**遗留:epay 升级单仍无法自动退款。** `CompleteSubscriptionOrder` 会用网关回调 JSON
覆盖 `order.ProviderPayload`,把下单时写入的报价(含 `remaining_value`)销毁,因此
epay 升级单退款时取不到该值 —— 当前实现选择**直接拒绝并提示人工核算**,而不是少退。
要解锁它,需把升级报价持久化到独立列(与 4.7 / 4.8 同一类改造),见下表 4.9。

---

## 5. 进度表

第一梯队(建议本迭代):

- [ ] 2.1 优雅关闭(SIGTERM + Shutdown 排空 + 部署宽限期)
- [ ] 2.2 CI 构建测试门禁(go build/vet/test + 前端 typecheck/lint)
- [ ] 2.3a 订阅到期提醒(T-7/T-3/T-1,含去重)
- [ ] 2.3b 订阅自动续费(余额扣费,失败降级提醒)

第二梯队(下一迭代):

- [ ] 3.1 管理员审计表 + 操作人贯穿 + 后台查询页 ← **退款功能已上线,优先**
- [ ] 3.2 发票申请流程 + 账单 CSV 导出
- [ ] 3.3 Prometheus 指标 + `/healthz` `/readyz`

第三梯队(按需):

- [ ] 4.1 组织/团队/子账号
- [ ] 4.2 渠道密钥加密存储
- [ ] 4.3 版本化数据库迁移
- [ ] 4.4 日志留存与归档
- [ ] 4.5 数据导出与留存策略
- [ ] 4.6 对公/后付费

资金记账(4bis,建议与 3.1 审计表同批):

- [ ] 4.7 `TopUp.CreditedQuota` 落列,退款不再按当前汇率反算
- [ ] 4.8 `SubscriptionOrder.ChargedQuota` 落列,退款不再刮取 payload
- [x] 4.9a 升级单退款返还源订阅剩余价值(口径=全额折现,已实现 + 回归测试)
- [ ] 4.9b 升级报价落列,解锁 epay 升级单自动退款(现为拒绝并提示人工核算)
