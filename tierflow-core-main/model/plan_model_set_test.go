package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func setupPlanModelSetTables(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&ModelGroup{}, &ModelGroupMember{}, &PlanModelSet{}, &PlanModelSetMember{}))
	t.Cleanup(func() {
		DB.Exec("DELETE FROM plan_model_set_members")
		DB.Exec("DELETE FROM plan_model_sets")
		DB.Exec("DELETE FROM model_group_members")
		DB.Exec("DELETE FROM model_groups")
	})
	// 重建缓存,避免跨测试脏读
	t.Cleanup(func() {
		InvalidatePlanModelSetCache()
		InvalidateModelGroupCache()
	})
}

func insertModelGroupWithModel(t *testing.T, id int, name, modelName string) {
	t.Helper()
	require.NoError(t, DB.Create(&ModelGroup{Id: id, Name: name, Enabled: true}).Error)
	require.NoError(t, DB.Create(&ModelGroupMember{GroupId: id, ChannelId: 1, ModelName: modelName}).Error)
}

func TestResolveModelBucket(t *testing.T) {
	truncateTables(t)
	setupPlanModelSetTables(t)

	insertModelGroupWithModel(t, 11, "mg-basic", "basic-model")
	insertModelGroupWithModel(t, 12, "mg-gpt", "gpt-5.5")

	basicSet := &PlanModelSet{Name: "basic-set", Enabled: true}
	require.NoError(t, AddPlanModelSet(basicSet, []PlanModelSetMember{{ModelGroupId: 11}}))
	premiumSet := &PlanModelSet{Name: "premium-set", Enabled: true}
	require.NoError(t, AddPlanModelSet(premiumSet, []PlanModelSetMember{{ModelGroupId: 12}}))

	plan := &SubscriptionPlan{BasicSetId: basicSet.Id, PremiumSetId: premiumSet.Id}

	// 按 model_group_id 判定
	require.Equal(t, BucketBasic, ResolveModelBucket(plan, 11, ""))
	require.Equal(t, BucketPremium, ResolveModelBucket(plan, 12, ""))
	// 按模型名反查
	require.Equal(t, BucketBasic, ResolveModelBucket(plan, 0, "basic-model"))
	require.Equal(t, BucketPremium, ResolveModelBucket(plan, 0, "gpt-5.5"))
	// 未命中/未配置 → 保守 premium
	require.Equal(t, BucketPremium, ResolveModelBucket(plan, 0, "unknown-model"))
	require.Equal(t, BucketPremium, ResolveModelBucket(&SubscriptionPlan{}, 11, "basic-model"))
	require.Equal(t, BucketPremium, ResolveModelBucket(nil, 11, ""))
}

func TestPlanModelSetCRUDAndGuards(t *testing.T) {
	truncateTables(t)
	setupPlanModelSetTables(t)

	insertModelGroupWithModel(t, 21, "mg-a", "model-a")

	// 引用不存在的模型组 → 拒绝
	bad := &PlanModelSet{Name: "bad"}
	require.Error(t, AddPlanModelSet(bad, []PlanModelSetMember{{ModelGroupId: 999}}))
	// 重复成员 → 拒绝
	dup := &PlanModelSet{Name: "dup"}
	require.Error(t, AddPlanModelSet(dup, []PlanModelSetMember{{ModelGroupId: 21}, {ModelGroupId: 21}}))

	ok := &PlanModelSet{Name: "ok", Enabled: true}
	require.NoError(t, AddPlanModelSet(ok, []PlanModelSetMember{{ModelGroupId: 21}}))

	// 被套餐引用时禁止删除
	require.NoError(t, DB.Create(&SubscriptionPlan{Id: 301, Title: "P", PriceAmount: 1, DurationUnit: "day", DurationValue: 30, BasicSetId: ok.Id}).Error)
	require.Error(t, DeletePlanModelSetById(ok.Id))
	require.NoError(t, DB.Exec("DELETE FROM subscription_plans WHERE id = 301").Error)
	require.NoError(t, DeletePlanModelSetById(ok.Id))

	// ValidatePlanModelSetId
	require.NoError(t, ValidatePlanModelSetId(0, "x"))
	require.Error(t, ValidatePlanModelSetId(-1, "x"))
	require.Error(t, ValidatePlanModelSetId(999, "x"))
}
