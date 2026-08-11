package model

import (
	"sort"

	"github.com/Zer0Echo/tierflow-core/common"
)

// 管理员「资金看板(财务)」聚合：充值(付费) / 消费(营收) / 上游成本 / 毛利 的时间序列，
// 外加全站当前总余额。设计取舍见 memory/finance-dashboard-design。
//
// 口径说明(订阅制上线后的完整版本)：
//   - 充值总额 = 全部 status=success 的 TopUp.money，含套餐订阅订单(订阅支付成功会经
//     upsertSubscriptionTopUpTx 写入同 trade_no 的 TopUp)。其中「余额购买套餐」
//     (payment_method='balance') 只是钱包内部转移——那笔钱最初充值进钱包时已计过一次，
//     所以另给 RechargeCash(现金流入,排除 balance)承载不重复计数的口径；充值总额本身
//     保持旧语义不变，避免历史对比跳变。
//   - 消费口径 = 用户被扣的 quota(营收) 与上游成本(provider_cost) 同时给出，毛利=营收-成本。
//     按 logs.billing_source 拆钱包实扣 / 订阅额度消耗：订阅的 quota 是名义售价(用户实付的
//     是固定月费)，其中 basic 桶(按 token 计量、常为包量/无限量)名义程度最高，单列一档。
//     billing_source 为空 = 加列前的历史日志，统一按 wallet 归一——营收拆分只对迁移后
//     的数据有效，充值拆分(靠 subscription_orders EXISTS)对全部历史成立。
//   - 同一笔订阅收入会在「充值」(购买时的现金)与「营收」(有效期内的额度消耗)各出现一次，
//     两侧 KPI 不可相加。
//   - 余额 = 当前 SUM(users.quota) 标量，无历史曲线(现有数据无余额快照)。
//
// 时间分桶按「小时」(created_at - created_at%3600)，与 quota_data / 模型明细看板一致，
// 由前端按所选粒度(day/hour) 二次归并；整数取模在 SQLite/MySQL/PostgreSQL 三库通用。

// FinancePoint 单个小时桶的资金数据点。
type FinancePoint struct {
	CreatedAt     int64   `json:"created_at"`     // 小时桶起点(unix 秒)
	Recharge      float64 `json:"recharge"`       // 充值总额(TopUp.money，支付货币；含余额购买套餐)
	RechargeCount int64   `json:"recharge_count"` // 充值笔数
	// 充值来源拆分(均为支付货币)：Recharge = RechargeCash + RechargeFromBalance；
	// RechargeCash = RechargeWallet + RechargeSubscription。
	RechargeCash         float64 `json:"recharge_cash"`         // 现金流入(排除 payment_method='balance' 的余额购买)
	RechargeWallet       float64 `json:"recharge_wallet"`       // 其中钱包充值
	RechargeSubscription float64 `json:"recharge_subscription"` // 其中套餐现金购买
	RechargeFromBalance  float64 `json:"recharge_from_balance"` // 套餐余额购买(钱包内部转移,不计现金)
	Revenue              int64   `json:"revenue"`               // 消费营收合计(quota，= 用户被扣额度)
	// 营收来源拆分(quota)：Revenue = RevenueWallet + RevenueSubscription。
	RevenueWallet            int64 `json:"revenue_wallet"`             // 钱包实扣(含 billing_source 为空的历史日志)
	RevenueSubscription      int64 `json:"revenue_subscription"`       // 订阅额度消耗(名义售价)
	RevenueSubscriptionBasic int64 `json:"revenue_subscription_basic"` // 其中 basic 桶(名义程度最高)
	ProviderCost             int64 `json:"provider_cost"`              // 上游成本合计(quota)
	Margin                   int64 `json:"margin"`                     // 毛利(quota) = Revenue - ProviderCost
	Count                    int64 `json:"count"`                      // 消费请求数
}

// FinanceSummary 资金看板返回体：时间序列 + 区间状态 KPI + 当前总余额。
type FinanceSummary struct {
	StartTimestamp int64          `json:"start_timestamp"`
	EndTimestamp   int64          `json:"end_timestamp"`
	Points         []FinancePoint `json:"points"`

	// 区间状态(所选区间内合计)
	TotalRecharge      float64 `json:"total_recharge"`       // Σ 充值总额(支付货币，含余额购买)
	TotalRechargeCount int64   `json:"total_recharge_count"` // Σ 充值笔数
	// 充值来源拆分(口径同 FinancePoint 对应字段)
	TotalRechargeCash         float64 `json:"total_recharge_cash"`
	TotalRechargeWallet       float64 `json:"total_recharge_wallet"`
	TotalRechargeSubscription float64 `json:"total_recharge_subscription"`
	TotalRechargeFromBalance  float64 `json:"total_recharge_from_balance"`
	TotalRevenue              int64   `json:"total_revenue"` // Σ 消费营收(quota)
	// 营收来源拆分(口径同 FinancePoint 对应字段)
	TotalRevenueWallet            int64 `json:"total_revenue_wallet"`
	TotalRevenueSubscription      int64 `json:"total_revenue_subscription"`
	TotalRevenueSubscriptionBasic int64 `json:"total_revenue_subscription_basic"`
	TotalProviderCost             int64 `json:"total_provider_cost"` // Σ 上游成本(quota)
	TotalMargin                   int64 `json:"total_margin"`        // Σ 毛利(quota)
	TotalRequests                 int64 `json:"total_requests"`      // Σ 消费请求数

	// 当前全站总余额(标量，与区间无关)：SUM(users.quota)
	CurrentBalance int64 `json:"current_balance"`
}

// GetFinanceData 聚合区间 [start,end] 的资金时间序列与区间汇总，并附当前总余额。
func GetFinanceData(start int64, end int64) (FinanceSummary, error) {
	s := FinanceSummary{}
	if end <= 0 {
		end = common.GetTimestamp()
	}
	if start <= 0 {
		start = end - 7*86400
	}
	s.StartTimestamp = start
	s.EndTimestamp = end

	// 1) 消费/成本：logs(type=consume) 按小时桶聚合(LOG_DB)。
	// billing_source 为空(加列前历史)归 wallet；CASE WHEN 为标准 SQL，三库通用。
	type consumeRow struct {
		Bucket          int64
		Count           int64
		Revenue         int64
		RevenueSub      int64
		RevenueSubBasic int64
		ProviderCost    int64
	}
	var crows []consumeRow
	if err := LOG_DB.Model(&Log{}).
		Select("(created_at - (created_at % 3600)) as bucket, COUNT(*) as count, "+
			"COALESCE(SUM(quota),0) as revenue, "+
			"COALESCE(SUM(CASE WHEN billing_source = 'subscription' THEN quota ELSE 0 END),0) as revenue_sub, "+
			"COALESCE(SUM(CASE WHEN billing_source = 'subscription' AND subscription_bucket = 'basic' THEN quota ELSE 0 END),0) as revenue_sub_basic, "+
			"COALESCE(SUM(provider_cost),0) as provider_cost").
		Where("type = ? AND created_at >= ? AND created_at <= ?", LogTypeConsume, start, end).
		Group("created_at - (created_at % 3600)").
		Scan(&crows).Error; err != nil {
		return s, err
	}

	// 2) 充值：TopUp(status=success) 按完成时间小时桶聚合(DB)。
	// 易支付(epay)成功回调历史上未写 complete_time(恒为 0)，回退到 create_time，
	// 否则这些订单会被时间过滤漏掉(根因已在 controller/topup.go EpayNotify 修复)。
	// 来源拆分的两个判据：
	//   - 余额购买 = payment_method='balance'。注意不能用 payment_provider：
	//     upsertSubscriptionTopUpTx 写 TopUp 时不带 PaymentProvider(实库里订阅
	//     TopUp 的 provider 恒为空串)，而 PaymentMethod 会原样复制；'balance'
	//     只由订阅的余额购买/升级两条路径写入，钱包 epay 充值的 method 需过
	//     管理员配置的支付方式白名单(ContainsPayMethod)，不会撞名。该列上线前的
	//     历史行是 NULL，`NULL <> 'balance'` 判 UNKNOWN 会被 CASE 当 false 吞掉，
	//     必须 COALESCE 成空串——历史现金充值才不会被错归成余额购买。
	//   - 是否套餐订单靠 EXISTS(subscription_orders 同 trade_no)判定——订阅成功写
	//     TopUp 与订单行在同一事务(upsertSubscriptionTopUpTx 的三个调用点均先
	//     Create(order))，不会漏判；两表同在主库，跨表子查询安全。
	// wallet 分项不在 SQL 里单算(省一次相关子查询)，由 Cash − Sub 在 Go 侧推导，
	// 与 FromBalance = Money − Cash 的推导风格一致。
	// COALESCE/NULLIF/CASE/EXISTS 均为标准 SQL，SQLite/MySQL/PostgreSQL 三库通用。
	// 兑换码开通的订阅要整条排除在「充值」之外：它金额记 0，但仍写 TopUp 行(否则这笔订阅
	// 在 /billing 与管理端订单列表完全不可见)。金额为 0 不影响任何 ¥ 汇总，但 COUNT(*) 会把
	// 每张兑换码算成一笔充值 —— 发 500 张促销码，看板就显示「500 笔付费充值」对 ¥0 收入，
	// 由 Recharge ÷ RechargeCount 推出的客单价也会被压向 0。它既不是现金也不是余额购买，
	// 不属于充值口径，故在 WHERE 里剔除而非在 CASE 里改归类。
	const topupTime = "COALESCE(NULLIF(complete_time, 0), create_time)"
	const isSubOrder = "EXISTS(SELECT 1 FROM subscription_orders so WHERE so.trade_no = top_ups.trade_no)"
	const notBalance = "COALESCE(payment_method, '') <> 'balance'"
	const notRedemption = "COALESCE(payment_method, '') <> '" + PaymentMethodRedemption + "'"
	type rechargeRow struct {
		Bucket    int64
		Count     int64
		Money     float64
		CashMoney float64
		SubMoney  float64
	}
	var rrows []rechargeRow
	if err := DB.Model(&TopUp{}).
		Select("("+topupTime+" - ("+topupTime+" % 3600)) as bucket, COUNT(*) as count, "+
			"COALESCE(SUM(money),0) as money, "+
			"COALESCE(SUM(CASE WHEN "+notBalance+" THEN money ELSE 0 END),0) as cash_money, "+
			"COALESCE(SUM(CASE WHEN "+notBalance+" AND "+isSubOrder+" THEN money ELSE 0 END),0) as sub_money").
		Where("status = ? AND "+notRedemption+" AND "+topupTime+" >= ? AND "+topupTime+" <= ?",
			common.TopUpStatusSuccess, start, end).
		Group(topupTime + " - (" + topupTime + " % 3600)").
		Scan(&rrows).Error; err != nil {
		return s, err
	}

	// 3) 按小时桶合并两侧序列。
	points := make(map[int64]*FinancePoint)
	getPoint := func(bucket int64) *FinancePoint {
		p, ok := points[bucket]
		if !ok {
			p = &FinancePoint{CreatedAt: bucket}
			points[bucket] = p
		}
		return p
	}
	for _, r := range crows {
		p := getPoint(r.Bucket)
		p.Revenue = r.Revenue
		p.RevenueSubscription = r.RevenueSub
		p.RevenueSubscriptionBasic = r.RevenueSubBasic
		p.RevenueWallet = r.Revenue - r.RevenueSub
		p.ProviderCost = r.ProviderCost
		p.Margin = r.Revenue - r.ProviderCost
		p.Count = r.Count
		s.TotalRevenue += r.Revenue
		s.TotalRevenueSubscription += r.RevenueSub
		s.TotalRevenueSubscriptionBasic += r.RevenueSubBasic
		s.TotalProviderCost += r.ProviderCost
		s.TotalRequests += r.Count
	}
	for _, r := range rrows {
		p := getPoint(r.Bucket)
		p.Recharge = r.Money
		p.RechargeCount = r.Count
		p.RechargeCash = r.CashMoney
		p.RechargeWallet = r.CashMoney - r.SubMoney
		p.RechargeSubscription = r.SubMoney
		p.RechargeFromBalance = r.Money - r.CashMoney
		s.TotalRecharge += r.Money
		s.TotalRechargeCount += r.Count
		s.TotalRechargeCash += r.CashMoney
		s.TotalRechargeWallet += r.CashMoney - r.SubMoney
		s.TotalRechargeSubscription += r.SubMoney
		s.TotalRechargeFromBalance += r.Money - r.CashMoney
	}
	s.TotalRevenueWallet = s.TotalRevenue - s.TotalRevenueSubscription
	s.TotalMargin = s.TotalRevenue - s.TotalProviderCost

	out := make([]FinancePoint, 0, len(points))
	for _, p := range points {
		out = append(out, *p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	s.Points = out

	// 4) 当前全站总余额：SUM(users.quota)(排除软删用户)。
	var currentBalance int64
	if err := DB.Model(&User{}).
		Select("COALESCE(SUM(quota),0)").
		Scan(&currentBalance).Error; err != nil {
		return s, err
	}
	s.CurrentBalance = currentBalance

	return s, nil
}
