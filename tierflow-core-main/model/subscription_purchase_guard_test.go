package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
)

// requireCompleteOrder 断言回调成功并返回 outcome,供各用例复用。
func requireCompleteOrder(t *testing.T, tradeNo string) SubscriptionOrderOutcome {
	t.Helper()
	outcome, err := CompleteSubscriptionOrder(tradeNo, "payload", PaymentProviderEpay, "alipay")
	require.NoError(t, err)
	return outcome
}

// 有生效订阅时的新购守卫与 epay 升级订单/回调的行为测试。
// 规则(已确认的产品决策):同套餐可叠加续费;更高档只许升级;低/平级其它套餐拦截。

func TestActivePurchaseGuard(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 601, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	sibling := insertDualBucketPlan(t, 602, 1000, 500)
	sibling.PriceAmount = 9.9
	require.NoError(t, DB.Save(sibling).Error)
	expensive := insertDualBucketPlan(t, 603, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	require.NoError(t, DB.Create(&User{Id: 61, Username: "guard-user", Quota: 100_000_000}).Error)

	// 无生效订阅:任意套餐可购
	require.NoError(t, CheckActivePurchaseAllowed(61, expensive))
	require.NoError(t, CheckActivePurchaseAllowed(61, cheap))

	sub := createSubViaTx(t, 61, cheap)

	// 同套餐 → 放行(叠加续费)
	require.NoError(t, CheckActivePurchaseAllowed(61, cheap))
	// 平级其它套餐 → 拦截
	require.ErrorIs(t, CheckActivePurchaseAllowed(61, sibling), ErrSubscriptionNotUpgradable)
	// 更高档 → 引导升级
	require.ErrorIs(t, CheckActivePurchaseAllowed(61, expensive), ErrSubscriptionUpgradeOnly)

	// 余额购买链路同样被拦(权威拦截在事务内)
	_, err := PurchaseSubscriptionWithBalance(61, sibling.Id)
	require.ErrorIs(t, err, ErrSubscriptionNotUpgradable)
	_, err = PurchaseSubscriptionWithBalance(61, expensive.Id)
	require.ErrorIs(t, err, ErrSubscriptionUpgradeOnly)
	// 同套餐续费照常成功
	_, err = PurchaseSubscriptionWithBalance(61, cheap.Id)
	require.NoError(t, err)

	// 订阅失效后恢复可购
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ?", 61).
		Updates(map[string]interface{}{"status": "cancelled", "end_time": GetDBTimestamp() - 10}).Error)
	require.NoError(t, CheckActivePurchaseAllowed(61, sibling))
	_ = sub
}

func TestUpgradeEpayOrderAndCompletion(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 611, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	expensive := insertDualBucketPlan(t, 612, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	require.NoError(t, DB.Create(&User{Id: 62, Username: "epay-up-user", Quota: 0}).Error)
	sub := createSubViaTx(t, 62, cheap)

	// 下单:金额 = 报价差价(剩余 30 天 → 60.0)
	tradeNo := fmt.Sprintf("SUBUPGEPAYUSR62NO%d", time.Now().UnixNano())
	order, quote, err := CreateSubscriptionUpgradeEpayOrder(62, sub.Id, expensive.Id, tradeNo, "alipay")
	require.NoError(t, err)
	require.Equal(t, SubscriptionOrderTypeUpgrade, order.OrderType)
	require.Equal(t, sub.Id, order.FromSubscriptionId)
	require.InDelta(t, 60.0, order.Money, 0.01)
	require.InDelta(t, quote.AmountDue, order.Money, 0.001)

	// 只升不降/同套餐在下单时即拦截
	_, _, err = CreateSubscriptionUpgradeEpayOrder(62, sub.Id, cheap.Id, tradeNo+"x", "alipay")
	require.Error(t, err)

	// 同源订阅仅一张 pending 单:新单作废旧单
	tradeNo2 := tradeNo + "second"
	_, _, err = CreateSubscriptionUpgradeEpayOrder(62, sub.Id, expensive.Id, tradeNo2, "alipay")
	require.NoError(t, err)
	var first SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&first).Error)
	require.Equal(t, common.TopUpStatusExpired, first.Status)

	// 回调完成:旧订阅作废、旧 Key 禁用、新订阅 source=upgrade、订单 success
	requireCompleteOrder(t, tradeNo2)
	var oldSub UserSubscription
	require.NoError(t, DB.First(&oldSub, sub.Id).Error)
	require.Equal(t, "cancelled", oldSub.Status)
	var oldToken Token
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&oldToken).Error)
	require.Equal(t, common.TokenStatusDisabled, oldToken.Status)

	var newSub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND status = ?", 62, "active").First(&newSub).Error)
	require.Equal(t, expensive.Id, newSub.PlanId)
	require.Equal(t, SubscriptionSourceUpgrade, newSub.Source)

	var done SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo2).First(&done).Error)
	require.Equal(t, common.TopUpStatusSuccess, done.Status)
	require.Equal(t, newSub.Id, done.UserSubscriptionId)

	// 幂等:重复回调不再产生新订阅
	requireCompleteOrder(t, tradeNo2)
	var activeCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ?", 62, "active").Count(&activeCount).Error)
	require.EqualValues(t, 1, activeCount)
}

func TestUpgradeEpayManualReviewAndBalanceRace(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 621, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	expensive := insertDualBucketPlan(t, 622, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	require.NoError(t, DB.Create(&User{Id: 63, Username: "manual-user", AffCode: "t63", Quota: 100_000_000}).Error)
	sub := createSubViaTx(t, 63, cheap)

	// 竞态:先下 epay 升级单,再余额升级 → pending 单被作废
	tradeNo := fmt.Sprintf("SUBUPGEPAYUSR63NO%d", time.Now().UnixNano())
	_, _, err := CreateSubscriptionUpgradeEpayOrder(63, sub.Id, expensive.Id, tradeNo, "alipay")
	require.NoError(t, err)
	_, _, err = UpgradeSubscriptionWithBalance(63, sub.Id, expensive.Id)
	require.NoError(t, err)
	var voided SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&voided).Error)
	require.Equal(t, common.TopUpStatusExpired, voided.Status)

	// 已作废的单随后收到真实付款回调:不交付(防一次差价两次升级)、
	// 不报错(防网关无限重试),转 manual_review 且写 TopUp 留财务痕迹
	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, tradeNo))
	require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&voided).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, voided.Status)
	manualTopUp := GetTopUpByTradeNo(tradeNo)
	require.NotNil(t, manualTopUp, "转人工的真实收款必须写入 TopUp 供财务对账")
	// 账单页渲染 TopUp.status:转人工绝不能显示「成功」,应为 pending(处理中)
	require.Equal(t, common.TopUpStatusPending, manualTopUp.Status)
	// 升级只发生了一次(余额那次)
	var upCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND source = ?", 63, SubscriptionSourceUpgrade).Count(&upCount).Error)
	require.EqualValues(t, 1, upCount)

	// 源订阅失效时的回调 → 转人工(不自动发放)。
	// 构造:pending 升级单 + 源订阅被强制过期。
	require.NoError(t, DB.Create(&User{Id: 64, Username: "manual-user2", AffCode: "t64", Quota: 0}).Error)
	sub2 := createSubViaTx(t, 64, cheap)
	tradeNo2 := fmt.Sprintf("SUBUPGEPAYUSR64NO%d", time.Now().UnixNano())
	_, _, err = CreateSubscriptionUpgradeEpayOrder(64, sub2.Id, expensive.Id, tradeNo2, "alipay")
	require.NoError(t, err)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", sub2.Id).
		Update("end_time", GetDBTimestamp()-10).Error)

	requireCompleteOrder(t, tradeNo2)
	var manual SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo2).First(&manual).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, manual.Status)
	// 未自动发放新订阅(源订阅已过期,用户 64 无 active 订阅)
	var activeCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ?", 64, "active", GetDBTimestamp()).
		Count(&activeCount).Error)
	require.EqualValues(t, 0, activeCount)

	// 重复回调直接吞掉(返回 nil),状态保持人工处理
	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, tradeNo2))
	require.NoError(t, DB.Where("trade_no = ?", tradeNo2).First(&manual).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, manual.Status)
	// manual_review 也要写 TopUp(真实收款进财务对账表)
	require.NotNil(t, GetTopUpByTradeNo(tradeNo2))
}

func TestUpgradeEpayStaleQuoteAndPurchaseRecheck(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 631, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	expensive := insertDualBucketPlan(t, 632, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	// --- 陈旧报价:超过有效窗口后才付款 → 转人工,不按旧差价交付 ---
	require.NoError(t, DB.Create(&User{Id: 65, Username: "stale-user", AffCode: "t65", Quota: 0}).Error)
	sub := createSubViaTx(t, 65, cheap)
	tradeNo := fmt.Sprintf("SUBUPGEPAYUSR65NO%d", time.Now().UnixNano())
	_, _, err := CreateSubscriptionUpgradeEpayOrder(65, sub.Id, expensive.Id, tradeNo, "alipay")
	require.NoError(t, err)
	// 把下单时间拨回 TTL 之外
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Where("trade_no = ?", tradeNo).
		Update("create_time", common.GetTimestamp()-subscriptionUpgradeOrderTTLSeconds-60).Error)

	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, tradeNo))
	var stale SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&stale).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, stale.Status)
	// 源订阅未被动过,升级未发生
	var srcSub UserSubscription
	require.NoError(t, DB.First(&srcSub, sub.Id).Error)
	require.Equal(t, "active", srcSub.Status)

	// --- 新购回调复检守卫:下单后购入高档,付款时不得交付低档并存 ---
	require.NoError(t, DB.Create(&User{Id: 66, Username: "recheck-user", AffCode: "t66", Quota: 100_000_000}).Error)
	newTradeNo := fmt.Sprintf("SUBNEWUSR66NO%d", time.Now().UnixNano())
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId:          66,
		PlanId:          cheap.Id,
		Money:           cheap.PriceAmount,
		TradeNo:         newTradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
		OrderType:       SubscriptionOrderTypeNew,
		CreateTime:      common.GetTimestamp(),
	}).Error)
	// 付款前用户已持有高档生效订阅
	_ = createSubViaTx(t, 66, expensive)

	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, newTradeNo))
	var blocked SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", newTradeNo).First(&blocked).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, blocked.Status)
	// 低档未被交付
	var cheapCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ? AND plan_id = ?", 66, cheap.Id).Count(&cheapCount).Error)
	require.EqualValues(t, 0, cheapCount)

	// 同套餐续费(guard 放行)在回调侧照常交付
	renewTradeNo := fmt.Sprintf("SUBRENEWUSR66NO%d", time.Now().UnixNano())
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId:          66,
		PlanId:          expensive.Id,
		Money:           expensive.PriceAmount,
		TradeNo:         renewTradeNo,
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		Status:          common.TopUpStatusPending,
		OrderType:       SubscriptionOrderTypeNew,
		CreateTime:      common.GetTimestamp(),
	}).Error)
	require.Equal(t, SubscriptionOrderOutcomeDelivered, requireCompleteOrder(t, renewTradeNo))
	// 二次回调幂等
	require.Equal(t, SubscriptionOrderOutcomeAlreadyDone, requireCompleteOrder(t, renewTradeNo))
}

// 交付时命中购买上限(双 pending 单竞态,云端/本地 review 双确认的资损场景):
// 预检只数已有订阅、不数 pending 单,同一 cap=1 套餐可开出两张 pending 单;
// 第二张付款时守卫放行(同套餐续费)但建订阅命中 cap → 必须转人工而非报错重试。
func TestNewPurchaseCapHitAtDelivery(t *testing.T) {
	truncateTables(t)
	capped := insertDualBucketPlan(t, 641, 1000, 500)
	capped.PriceAmount = 9.9
	capped.MaxPurchasePerUser = 1
	require.NoError(t, DB.Save(capped).Error)

	require.NoError(t, DB.Create(&User{Id: 67, Username: "cap-user", AffCode: "t67", Quota: 0}).Error)

	mkOrder := func(tradeNo string) {
		require.NoError(t, DB.Create(&SubscriptionOrder{
			UserId:          67,
			PlanId:          capped.Id,
			Money:           capped.PriceAmount,
			TradeNo:         tradeNo,
			PaymentMethod:   "alipay",
			PaymentProvider: PaymentProviderEpay,
			Status:          common.TopUpStatusPending,
			OrderType:       SubscriptionOrderTypeNew,
			CreateTime:      common.GetTimestamp(),
		}).Error)
	}
	no1 := fmt.Sprintf("SUBUSR67NO%d-1", time.Now().UnixNano())
	no2 := fmt.Sprintf("SUBUSR67NO%d-2", time.Now().UnixNano())
	mkOrder(no1)
	mkOrder(no2)

	// 第一张正常交付
	require.Equal(t, SubscriptionOrderOutcomeDelivered, requireCompleteOrder(t, no1))
	// 第二张命中 cap → 转人工,写 pending TopUp,不新建订阅
	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, no2))
	var second SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", no2).First(&second).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, second.Status)
	topUp := GetTopUpByTradeNo(no2)
	require.NotNil(t, topUp)
	require.Equal(t, common.TopUpStatusPending, topUp.Status)
	var subCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).
		Where("user_id = ?", 67).Count(&subCount).Error)
	require.EqualValues(t, 1, subCount)
}

// 套餐被硬删后,已作废升级单仍收到付款回调:终态分支必须先于 plan 查询,
// 否则回调报错→网关无限重试、钱无痕迹。
func TestExpiredOrderCallbackAfterPlanDeleted(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 651, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	expensive := insertDualBucketPlan(t, 652, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	require.NoError(t, DB.Create(&User{Id: 68, Username: "del-plan-user", AffCode: "t68", Quota: 100_000_000}).Error)
	sub := createSubViaTx(t, 68, cheap)
	tradeNo := fmt.Sprintf("SUBUPGEPAYUSR68NO%d", time.Now().UnixNano())
	_, _, err := CreateSubscriptionUpgradeEpayOrder(68, sub.Id, expensive.Id, tradeNo, "alipay")
	require.NoError(t, err)
	// 余额升级作废 pending 单,然后硬删目标套餐(作废单不阻止删除)
	_, _, err = UpgradeSubscriptionWithBalance(68, sub.Id, expensive.Id)
	require.NoError(t, err)
	require.NoError(t, DB.Delete(&SubscriptionPlan{}, expensive.Id).Error)
	InvalidateSubscriptionPlanCache(expensive.Id)

	// 付款回调:plan 已不存在也必须走 expired→manual_review,不报错
	require.Equal(t, SubscriptionOrderOutcomeManualReview, requireCompleteOrder(t, tradeNo))
	var manual SubscriptionOrder
	require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&manual).Error)
	require.Equal(t, SubscriptionOrderStatusManualReview, manual.Status)
	require.NotNil(t, GetTopUpByTradeNo(tradeNo))
}
