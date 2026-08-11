package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionUpgrade(t *testing.T) {
	truncateTables(t)
	cheap := insertDualBucketPlan(t, 501, 1000, 500)
	cheap.PriceAmount = 9.9
	require.NoError(t, DB.Save(cheap).Error)
	expensive := insertDualBucketPlan(t, 502, 5000, BasicTokenUnlimited)
	expensive.PriceAmount = 69.9
	require.NoError(t, DB.Save(expensive).Error)

	// 用户余额充足
	require.NoError(t, DB.Create(&User{Id: 51, Username: "up-user", Quota: 10_000_000}).Error)

	sub := createSubViaTx(t, 51, cheap)

	// 报价:剩余 30 天 → 剩余价值 = 9.9,补差 = 60.0
	quote, err := QuoteSubscriptionUpgrade(51, sub.Id, expensive.Id)
	require.NoError(t, err)
	require.Equal(t, 30, quote.RemainingDays)
	require.InDelta(t, 9.9, quote.RemainingValue, 0.01)
	require.InDelta(t, 60.0, quote.AmountDue, 0.01)

	// 只升不降
	_, err = QuoteSubscriptionUpgrade(51, sub.Id, cheap.Id)
	require.Error(t, err)

	// 执行升级
	key, q2, err := UpgradeSubscriptionWithBalance(51, sub.Id, expensive.Id)
	require.NoError(t, err)
	require.NotEmpty(t, key)
	require.InDelta(t, quote.AmountDue, q2.AmountDue, 0.01)

	// 旧订阅 cancelled,旧 Key 禁用;新订阅 active,source=upgrade
	var oldSub UserSubscription
	require.NoError(t, DB.First(&oldSub, sub.Id).Error)
	require.Equal(t, "cancelled", oldSub.Status)
	var oldToken Token
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&oldToken).Error)
	require.Equal(t, common.TokenStatusDisabled, oldToken.Status)

	var newSub UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND status = ?", 51, "active").First(&newSub).Error)
	require.Equal(t, expensive.Id, newSub.PlanId)
	require.Equal(t, SubscriptionSourceUpgrade, newSub.Source)
	require.InDelta(t, 69.9, newSub.PaidMoney, 0.001, "新订阅快照目标套餐现价")

	// 升级订单可追溯
	var order SubscriptionOrder
	require.NoError(t, DB.Where("order_type = ?", SubscriptionOrderTypeUpgrade).First(&order).Error)
	require.Equal(t, newSub.Id, order.UserSubscriptionId)

	// 余额确实扣了差价(¥60 → quota)
	var u User
	require.NoError(t, DB.First(&u, 51).Error)
	require.Less(t, u.Quota, 10_000_000)

	// 已作废订阅不能再升级
	_, _, err = UpgradeSubscriptionWithBalance(51, sub.Id, expensive.Id)
	require.Error(t, err)
}
