package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
)

// 未被引用的套餐可以硬删除,并且缓存要一并失效。
func TestAdminDeleteSubscriptionPlanUnused(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 901, 1000, 500)

	// 先读一次把它灌进套餐缓存,验证删除后不会从缓存里"复活"
	cached, err := GetSubscriptionPlanById(plan.Id)
	require.NoError(t, err)
	require.Equal(t, plan.Id, cached.Id)

	require.NoError(t, AdminDeleteSubscriptionPlan(plan.Id))

	var count int64
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Count(&count).Error)
	require.Zero(t, count, "套餐行应已删除")

	_, err = GetSubscriptionPlanById(plan.Id)
	require.Error(t, err, "缓存应已失效,不能再查到已删除的套餐")
}

// 有未到期的用户订阅时必须拒绝,且套餐本身不能被删掉。
func TestAdminDeleteSubscriptionPlanBlockedByActiveSubscription(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 902, 1000, 500)
	insertActiveSubscription(t, 91, plan) // end_time = now + 30d

	err := AdminDeleteSubscriptionPlan(plan.Id)
	require.Error(t, err)
	require.Contains(t, err.Error(), "未到期", "拒绝原因应说明是订阅未到期")

	var count int64
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Count(&count).Error)
	require.EqualValues(t, 1, count, "被拒绝时套餐必须原样保留")
}

// 订阅到期后即可删除 —— 这是本次放宽的核心行为。
// 覆盖三种"已不在用"的形态:已过期(status=expired)、已取消,
// 以及后台过期任务还没跑到、status 仍是 active 但 end_time 已过的。
func TestAdminDeleteSubscriptionPlanAllowedAfterExpiry(t *testing.T) {
	now := common.GetTimestamp()

	cases := []struct {
		name    string
		status  string
		endTime int64
	}{
		{"已过期", "expired", now - 86400},
		{"已取消", "cancelled", now + 86400}, // 未到期但已取消,同样不算在用
		{"到期但状态未刷新", "active", now - 60},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			planId := 910 + i
			plan := insertDualBucketPlan(t, planId, 1000, 500)
			sub := &UserSubscription{
				UserId:    95,
				PlanId:    plan.Id,
				StartTime: now - 30*86400,
				EndTime:   tc.endTime,
				Status:    tc.status,
				Source:    "admin",
			}
			require.NoError(t, DB.Create(sub).Error)

			require.NoError(t, AdminDeleteSubscriptionPlan(plan.Id))

			var count int64
			require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Count(&count).Error)
			require.Zero(t, count)
		})
	}
}

// 支付中的订单要拦住:回调建订阅前会反查套餐,套餐没了这笔已付款的订单会失败。
func TestAdminDeleteSubscriptionPlanBlockedByPendingOrder(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 903, 1000, 500)
	order := &SubscriptionOrder{
		UserId:  92,
		PlanId:  plan.Id,
		Money:   plan.PriceAmount,
		TradeNo: "test-trade-903",
		Status:  common.TopUpStatusPending,
	}
	require.NoError(t, order.Insert())

	err := AdminDeleteSubscriptionPlan(plan.Id)
	require.Error(t, err)
	require.Contains(t, err.Error(), "支付中")

	var count int64
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

// 已完成/已过期的历史订单不再阻止删除。
func TestAdminDeleteSubscriptionPlanAllowedWithSettledOrders(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 904, 1000, 500)
	for i, status := range []string{common.TopUpStatusSuccess, common.TopUpStatusExpired} {
		order := &SubscriptionOrder{
			UserId:  93,
			PlanId:  plan.Id,
			Money:   plan.PriceAmount,
			TradeNo: "test-trade-904-" + status,
			Status:  status,
		}
		require.NoError(t, order.Insert(), "order %d", i)
	}

	require.NoError(t, AdminDeleteSubscriptionPlan(plan.Id))

	var count int64
	require.NoError(t, DB.Model(&SubscriptionPlan{}).Where("id = ?", plan.Id).Count(&count).Error)
	require.Zero(t, count)
}

func TestAdminDeleteSubscriptionPlanInvalidArgs(t *testing.T) {
	truncateTables(t)
	require.Error(t, AdminDeleteSubscriptionPlan(0))
	require.Error(t, AdminDeleteSubscriptionPlan(-1))
	require.Error(t, AdminDeleteSubscriptionPlan(99999), "不存在的套餐应报错")
}
