package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
)

// 资金看板口径测试。重点盯三类容易安静算错的地方:
//   - 充值拆分:钱包充值 / 套餐现金购买 / 套餐余额购买(balance 不计现金流入);
//   - 营收拆分:billing_source 为空的历史日志必须归入 wallet;
//   - complete_time=0 的成功订单要回退 create_time 计入区间(易支付历史坑)。

// insertTopUp 按各写入路径的真实形态造行:
//   - 钱包 epay 充值:method=支付方式(如 alipay)、provider=epay;
//   - 订阅 TopUp(经 upsertSubscriptionTopUpTx):provider 恒为空串,method 复制自订单
//     ——现金购买是支付方式、余额购买是 'balance'。拆分判据因此用 method,不能用 provider。
func insertTopUp(t *testing.T, tradeNo string, money float64, method string, provider string, status string, completeTime int64, createTime int64) {
	t.Helper()
	require.NoError(t, DB.Create(&TopUp{
		UserId:          1,
		Amount:          0,
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   method,
		PaymentProvider: provider,
		CreateTime:      createTime,
		CompleteTime:    completeTime,
		Status:          status,
	}).Error)
}

func insertSubscriptionOrderRow(t *testing.T, tradeNo string, money float64, provider string) {
	t.Helper()
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId:          1,
		PlanId:          1,
		Money:           money,
		TradeNo:         tradeNo,
		PaymentMethod:   "test",
		PaymentProvider: provider,
		Status:          common.TopUpStatusSuccess,
		CreateTime:      common.GetTimestamp(),
		CompleteTime:    common.GetTimestamp(),
	}).Error)
}

func insertConsumeLog(t *testing.T, createdAt int64, quota int, providerCost int, billingSource string, bucket string) {
	t.Helper()
	require.NoError(t, LOG_DB.Create(&Log{
		UserId:             1,
		CreatedAt:          createdAt,
		Type:               LogTypeConsume,
		Strategy:           "test-model",
		Quota:              quota,
		ProviderCost:       providerCost,
		BillingSource:      billingSource,
		SubscriptionBucket: bucket,
	}).Error)
}

func TestGetFinanceDataSplitsRechargeBySource(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start, end := now-7200, now+60

	// 钱包充值(epay,无订阅订单)
	insertTopUp(t, "wallet-1", 100, "alipay", PaymentProviderEpay, common.TopUpStatusSuccess, now-100, now-200)
	insertTopUp(t, "wallet-2", 50, "wxpay", PaymentProviderEpay, common.TopUpStatusSuccess, now-100, now-200)
	// 套餐现金购买(同 trade_no 的订阅订单;upsertSubscriptionTopUpTx 不写 provider → 空串)
	insertTopUp(t, "sub-cash-1", 69.9, "alipay", "", common.TopUpStatusSuccess, now-100, now-200)
	insertSubscriptionOrderRow(t, "sub-cash-1", 69.9, PaymentProviderEpay)
	// 套餐余额购买(method='balance' —— 钱包内部转移,不是新增现金;provider 同样为空串)
	insertTopUp(t, "sub-bal-1", 39.9, PaymentMethodBalance, "", common.TopUpStatusSuccess, now-100, now-200)
	insertSubscriptionOrderRow(t, "sub-bal-1", 39.9, PaymentProviderBalance)
	// 未完成/过期订单不计
	insertTopUp(t, "pending-1", 999, "alipay", PaymentProviderEpay, common.TopUpStatusPending, 0, now-200)
	// 区间外不计
	insertTopUp(t, "old-1", 888, "alipay", PaymentProviderEpay, common.TopUpStatusSuccess, now-90000, now-90000)
	// 兑换码开通的订阅整条不计入充值口径:金额恒为 0,但若计入 COUNT(*),发一批促销码
	// 就会让看板显示「N 笔付费充值」对 ¥0 收入,客单价也被压向 0。
	insertTopUp(t, "sub-redeem-1", 0, PaymentMethodRedemption, "", common.TopUpStatusSuccess, now-100, now-200)
	insertSubscriptionOrderRow(t, "sub-redeem-1", 0, PaymentProviderRedemption)
	insertTopUp(t, "sub-redeem-2", 0, PaymentMethodRedemption, "", common.TopUpStatusSuccess, now-100, now-200)
	insertSubscriptionOrderRow(t, "sub-redeem-2", 0, PaymentProviderRedemption)

	s, err := GetFinanceData(start, end)
	require.NoError(t, err)

	require.InDelta(t, 100+50+69.9+39.9, s.TotalRecharge, 1e-9) // 总额语义不变:含余额购买
	require.Equal(t, int64(4), s.TotalRechargeCount)            // 两笔兑换码订阅不算充值笔数
	require.InDelta(t, 100+50+69.9, s.TotalRechargeCash, 1e-9) // 现金流入:排除 balance
	require.InDelta(t, 100+50, s.TotalRechargeWallet, 1e-9)
	require.InDelta(t, 69.9, s.TotalRechargeSubscription, 1e-9)
	require.InDelta(t, 39.9, s.TotalRechargeFromBalance, 1e-9)

	// 单点字段:全部落在同一小时桶,分项应与汇总一致
	require.Len(t, s.Points, 1)
	p := s.Points[0]
	require.InDelta(t, s.TotalRecharge, p.Recharge, 1e-9)
	require.InDelta(t, s.TotalRechargeCash, p.RechargeCash, 1e-9)
	require.InDelta(t, s.TotalRechargeFromBalance, p.RechargeFromBalance, 1e-9)
}

func TestGetFinanceDataSplitsRevenueByBillingSource(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start, end := now-7200, now+60

	insertConsumeLog(t, now-100, 1000, 300, "wallet", "")
	insertConsumeLog(t, now-100, 500, 100, "", "") // 迁移前历史日志 → 按 wallet 计
	insertConsumeLog(t, now-100, 2000, 800, "subscription", "premium")
	insertConsumeLog(t, now-100, 4000, 200, "subscription", "basic")
	// 非 consume 类型不计
	require.NoError(t, LOG_DB.Create(&Log{UserId: 1, CreatedAt: now - 100, Type: LogTypeTopup, Quota: 777}).Error)

	s, err := GetFinanceData(start, end)
	require.NoError(t, err)

	require.Equal(t, int64(1000+500+2000+4000), s.TotalRevenue)
	require.Equal(t, int64(1000+500), s.TotalRevenueWallet)
	require.Equal(t, int64(2000+4000), s.TotalRevenueSubscription)
	require.Equal(t, int64(4000), s.TotalRevenueSubscriptionBasic)
	require.Equal(t, int64(300+100+800+200), s.TotalProviderCost)
	require.Equal(t, s.TotalRevenue-s.TotalProviderCost, s.TotalMargin)
	require.Equal(t, int64(4), s.TotalRequests)

	require.Len(t, s.Points, 1)
	p := s.Points[0]
	require.Equal(t, s.TotalRevenue, p.Revenue)
	require.Equal(t, s.TotalRevenueWallet, p.RevenueWallet)
	require.Equal(t, s.TotalRevenueSubscription, p.RevenueSubscription)
	require.Equal(t, s.TotalRevenueSubscriptionBasic, p.RevenueSubscriptionBasic)
}

func TestGetFinanceDataTopUpCompleteTimeFallback(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start, end := now-7200, now+60

	// 历史易支付成功单 complete_time=0,应按 create_time 计入区间(既有回退逻辑不许回归)
	insertTopUp(t, "legacy-1", 20, "alipay", PaymentProviderEpay, common.TopUpStatusSuccess, 0, now-300)
	// create_time 也在区间外的不计
	insertTopUp(t, "legacy-2", 30, "alipay", PaymentProviderEpay, common.TopUpStatusSuccess, 0, now-90000)

	s, err := GetFinanceData(start, end)
	require.NoError(t, err)
	require.InDelta(t, 20, s.TotalRecharge, 1e-9)
	require.InDelta(t, 20, s.TotalRechargeCash, 1e-9)
	require.Equal(t, int64(1), s.TotalRechargeCount)
}

func TestGetFinanceDataNullPaymentMethodCountsAsCash(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	start, end := now-7200, now+60

	// payment_method 列上线前的历史行是 NULL(GORM Create 只会写 '',需 raw SQL 造)。
	// `NULL <> 'balance'` 在 SQL 里判 UNKNOWN,若不 COALESCE,这些真实现金充值会被
	// CASE 吞掉、进而被 FromBalance = Money − Cash 错归成「余额购买」。
	require.NoError(t, DB.Exec(
		"INSERT INTO top_ups (user_id, amount, money, trade_no, payment_method, payment_provider, create_time, complete_time, status) "+
			"VALUES (1, 0, 66, 'null-method-1', NULL, '', ?, ?, ?)",
		now-300, now-200, common.TopUpStatusSuccess,
	).Error)

	s, err := GetFinanceData(start, end)
	require.NoError(t, err)
	require.InDelta(t, 66, s.TotalRecharge, 1e-9)
	require.InDelta(t, 66, s.TotalRechargeCash, 1e-9)
	require.InDelta(t, 66, s.TotalRechargeWallet, 1e-9)
	require.InDelta(t, 0, s.TotalRechargeFromBalance, 1e-9)
}
