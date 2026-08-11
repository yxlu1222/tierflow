package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestGetSubscriptionBucketBalances(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 401, 1000, 500)
	sub := insertActiveSubscription(t, 41, plan)
	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, BucketPremium, 400))
	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, BucketBasic, 500))

	b, err := GetSubscriptionBucketBalances(sub.Id)
	require.NoError(t, err)
	require.True(t, b.PremiumAvailable())
	require.Equal(t, int64(600), b.PremiumRemaining)
	require.False(t, b.BasicAvailable(), "basic 用尽")

	// premium 历史语义 0=无限;basic -1=无限;basic 0=未配置
	planU := insertDualBucketPlan(t, 402, 0, BasicTokenUnlimited)
	subU := insertActiveSubscription(t, 42, planU)
	bu, err := GetSubscriptionBucketBalances(subU.Id)
	require.NoError(t, err)
	require.True(t, bu.PremiumUnlimited)
	require.True(t, bu.BasicUnlimited)
	require.True(t, bu.BasicAvailable())

	planN := insertDualBucketPlan(t, 403, 100, 0)
	subN := insertActiveSubscription(t, 43, planN)
	bn, err := GetSubscriptionBucketBalances(subN.Id)
	require.NoError(t, err)
	require.False(t, bn.BasicConfigured)
	require.False(t, bn.BasicAvailable())
}

func TestPickSetModelGroup(t *testing.T) {
	truncateTables(t)
	setupPlanModelSetTables(t)
	insertModelGroupWithModel(t, 61, "mg-x", "model-x")
	insertModelGroupWithModel(t, 62, "mg-y", "model-y")

	s := &PlanModelSet{Name: "pick-set", Enabled: true}
	require.NoError(t, AddPlanModelSet(s, []PlanModelSetMember{{ModelGroupId: 62}, {ModelGroupId: 61}}))

	gid, ok := PickSetModelGroup(s.Id)
	require.True(t, ok)
	require.Equal(t, 61, gid, "取最小 id,确定性")

	_, ok = PickSetModelGroup(0)
	require.False(t, ok)
	_, ok = PickSetModelGroup(9999)
	require.False(t, ok)
}
