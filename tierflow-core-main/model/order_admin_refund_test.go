package model

import (
	"testing"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 余额支付的订阅订单退款必须原额退回钱包 quota(余额支付无线下退款渠道),
// 否则用户既失订阅又失额度。这是最高风险的一条钱路径。
func TestAdminRefundSubscriptionOrder_BalanceRestoresQuota(t *testing.T) {
	truncateTables(t)

	prevRate := operation_setting.USDExchangeRate
	operation_setting.USDExchangeRate = 1
	t.Cleanup(func() { operation_setting.USDExchangeRate = prevRate })

	const userId = 90101
	const startQuota = 6_000_000
	require.NoError(t, DB.Create(&User{
		Id: userId, Username: "refund_bal", Status: common.UserStatusEnabled, Quota: startQuota,
	}).Error)
	plan := &SubscriptionPlan{
		Id: 90101, Title: "Bal Plan", PriceAmount: 9.99,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 1000,
	}
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(plan.Id)

	_, err := PurchaseSubscriptionWithBalance(userId, plan.Id)
	require.NoError(t, err)

	var afterBuy User
	require.NoError(t, DB.First(&afterBuy, userId).Error)
	require.Less(t, afterBuy.Quota, startQuota, "purchase should have charged quota")

	var order SubscriptionOrder
	require.NoError(t, DB.Where("user_id = ?", userId).First(&order).Error)
	require.Equal(t, common.TopUpStatusSuccess, order.Status)
	require.Equal(t, PaymentProviderBalance, order.PaymentProvider)

	msg, err := AdminRefundSubscriptionOrder(order.Id)
	require.NoError(t, err)
	assert.Contains(t, msg, "退回")

	var afterRefund User
	require.NoError(t, DB.First(&afterRefund, userId).Error)
	assert.Equal(t, startQuota, afterRefund.Quota, "balance refund must restore the charged quota")

	var refunded SubscriptionOrder
	require.NoError(t, DB.First(&refunded, order.Id).Error)
	assert.Equal(t, common.TopUpStatusRefunded, refunded.Status)

	if order.UserSubscriptionId > 0 {
		var sub UserSubscription
		require.NoError(t, DB.First(&sub, order.UserSubscriptionId).Error)
		assert.Equal(t, "cancelled", sub.Status, "produced subscription must be revoked")
	}
}

// 钱包充值退款回收额度须下取到 0,绝不使余额变负。
func TestAdminRefundTopUp_ClawbackFlooredAtZero(t *testing.T) {
	truncateTables(t)

	const userId = 90102
	require.NoError(t, DB.Create(&User{
		Id: userId, Username: "refund_claw", Status: common.UserStatusEnabled, Quota: 100,
	}).Error)
	// Amount=1 => credited = 1 * QuotaPerUnit(=500000)，远大于余额 100
	topUp := &TopUp{
		UserId: userId, Amount: 1, Money: 9.99, TradeNo: "WALLETCLAW1",
		PaymentMethod: "alipay", PaymentProvider: PaymentProviderEpay,
		Status: common.TopUpStatusSuccess, CreateTime: time.Now().Unix(),
	}
	require.NoError(t, topUp.Insert())

	require.NoError(t, AdminRefundTopUp("WALLETCLAW1", "127.0.0.1"))

	var u User
	require.NoError(t, DB.First(&u, userId).Error)
	assert.Equal(t, 0, u.Quota, "clawback must floor at 0, never negative")

	var refunded TopUp
	require.NoError(t, DB.Where("trade_no = ?", "WALLETCLAW1").First(&refunded).Error)
	assert.Equal(t, common.TopUpStatusRefunded, refunded.Status)
}

// 补发 manual_review 的**升级**订单必须复刻自动回调的交付语义:作废源订阅、
// 禁用其专用 Key,而不是在源订阅之外再发一个完整套餐 —— 否则用户只付了差价
// 却同时持有两个生效订阅、两把可用 Key。
func TestAdminDeliverSubscriptionOrder_UpgradeReplacesSourceSubscription(t *testing.T) {
	truncateTables(t)

	const userId = 90103
	require.NoError(t, DB.Create(&User{
		Id: userId, Username: "deliver_upgrade", Status: common.UserStatusEnabled, Quota: 0,
	}).Error)

	lowPlan := &SubscriptionPlan{
		Id: 90201, Title: "Low", PriceAmount: 99,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 1000,
	}
	highPlan := &SubscriptionPlan{
		Id: 90202, Title: "High", PriceAmount: 199,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 5000,
	}
	require.NoError(t, DB.Create(lowPlan).Error)
	require.NoError(t, DB.Create(highPlan).Error)
	InvalidateSubscriptionPlanCache(lowPlan.Id)
	InvalidateSubscriptionPlanCache(highPlan.Id)

	// 源订阅(生效中)+ 它的专用 Key
	var srcSub *UserSubscription
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		s, err := CreateUserSubscriptionFromPlanTx(tx, userId, lowPlan, "order")
		srcSub = s
		return err
	}))
	require.Equal(t, "active", srcSub.Status)

	var srcToken Token
	require.NoError(t, DB.Where("user_subscription_id = ?", srcSub.Id).First(&srcToken).Error)
	require.Equal(t, common.TokenStatusEnabled, srcToken.Status)

	// 转人工的 epay 升级差价单
	order := &SubscriptionOrder{
		UserId: userId, PlanId: highPlan.Id, Money: 100,
		TradeNo: "SUBUPGMANUAL1", PaymentMethod: "alipay",
		PaymentProvider:    PaymentProviderEpay,
		Status:             SubscriptionOrderStatusManualReview,
		OrderType:          SubscriptionOrderTypeUpgrade,
		FromSubscriptionId: srcSub.Id,
		CreateTime:         time.Now().Unix(),
	}
	require.NoError(t, order.Insert())

	_, err := AdminDeliverSubscriptionOrder(order.Id)
	require.NoError(t, err)

	// 源订阅必须已作废
	var afterSrc UserSubscription
	require.NoError(t, DB.First(&afterSrc, srcSub.Id).Error)
	assert.Equal(t, "cancelled", afterSrc.Status, "源订阅必须被作废")

	// 源订阅的专用 Key 必须已禁用
	var afterToken Token
	require.NoError(t, DB.First(&afterToken, srcToken.Id).Error)
	assert.Equal(t, common.TokenStatusDisabled, afterToken.Status, "旧 Key 必须禁用")

	// 该用户只应剩一个生效订阅,且是升级后的高档套餐
	var actives []UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND status = ?", userId, "active").Find(&actives).Error)
	require.Len(t, actives, 1, "不得出现两个并存的生效订阅")
	assert.Equal(t, highPlan.Id, actives[0].PlanId)

	var delivered SubscriptionOrder
	require.NoError(t, DB.First(&delivered, order.Id).Error)
	assert.Equal(t, common.TopUpStatusSuccess, delivered.Status)
	assert.Equal(t, actives[0].Id, delivered.UserSubscriptionId)
}

// 升级单退款必须「全额折现」:除了差价,还要退还升级时被抵扣掉的源订阅剩余
// 价值。否则用户既没有生效订阅、又只拿回差价,那部分已付未消耗的价值凭空消失。
//
// 构造:刚买的 ¥99 套餐(剩余价值 = 全额 ¥99)→ 升级到 ¥199(差价 ¥100)→ 退款。
// 断言钱包回到「只花了 ¥99 买 A」的位置,即净支出等于 A 的原价。
func TestAdminRefundSubscriptionOrder_UpgradeRefundsRemainingValue(t *testing.T) {
	truncateTables(t)

	prevRate := operation_setting.USDExchangeRate
	operation_setting.USDExchangeRate = 1
	t.Cleanup(func() { operation_setting.USDExchangeRate = prevRate })

	const userId = 90104
	const startQuota = 200_000_000
	require.NoError(t, DB.Create(&User{
		Id: userId, Username: "upgrade_refund", Status: common.UserStatusEnabled, Quota: startQuota,
	}).Error)

	lowPlan := &SubscriptionPlan{
		Id: 90301, Title: "Low", PriceAmount: 99,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 1000,
	}
	highPlan := &SubscriptionPlan{
		Id: 90302, Title: "High", PriceAmount: 199,
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 5000,
	}
	require.NoError(t, DB.Create(lowPlan).Error)
	require.NoError(t, DB.Create(highPlan).Error)
	InvalidateSubscriptionPlanCache(lowPlan.Id)
	InvalidateSubscriptionPlanCache(highPlan.Id)

	_, err := PurchaseSubscriptionWithBalance(userId, lowPlan.Id)
	require.NoError(t, err)

	var srcSub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND plan_id = ?", userId, lowPlan.Id).First(&srcSub).Error)

	var afterBuy User
	require.NoError(t, DB.First(&afterBuy, userId).Error)
	spentOnLowPlan := startQuota - afterBuy.Quota
	require.Positive(t, spentOnLowPlan)

	_, _, err = UpgradeSubscriptionWithBalance(userId, srcSub.Id, highPlan.Id)
	require.NoError(t, err)

	// 升级单:payload 必须带 remaining_value,否则退款会被拒
	var upgradeOrder SubscriptionOrder
	require.NoError(t, DB.Where("user_id = ? AND order_type = ?", userId, SubscriptionOrderTypeUpgrade).
		First(&upgradeOrder).Error)
	rv, ok := parseRemainingValue(upgradeOrder.ProviderPayload)
	require.True(t, ok, "余额升级必须记录 remaining_value")
	require.InDelta(t, 99.0, rv, 0.01, "刚购买的套餐剩余价值应为全额")

	msg, err := AdminRefundSubscriptionOrder(upgradeOrder.Id)
	require.NoError(t, err)
	assert.Contains(t, msg, "升级抵扣", "提示需说明已返还升级抵扣部分")

	// 钱包应回到「仅支出了 A 的原价」的位置:差价与被抵扣的剩余价值都已退回
	var afterRefund User
	require.NoError(t, DB.First(&afterRefund, userId).Error)
	assert.Equal(t, startQuota, afterRefund.Quota,
		"退款须同时返还差价与源订阅剩余价值,净支出应回到 A 的原价")

	// 升级产出的订阅应已撤销,用户无生效订阅
	var actives int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ?", userId, "active").Count(&actives).Error)
	assert.Zero(t, actives)
}
