package model

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 双桶预扣/结算/退款/重置的行为与隔离性测试。
// SQLite 下 FOR UPDATE 是 no-op,并发正确性依赖 MySQL/PG,此处只验证单线程语义。

func insertDualBucketPlan(t *testing.T, id int, premiumTotal, basicTotal int64) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{
		Id:              id,
		Title:           "Dual Bucket Plan",
		PriceAmount:     9.9,
		DurationUnit:    SubscriptionDurationDay,
		DurationValue:   30,
		Enabled:         true,
		TotalAmount:     premiumTotal,
		BasicTokenTotal: basicTotal,
	}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func insertActiveSubscription(t *testing.T, userId int, plan *SubscriptionPlan) *UserSubscription {
	t.Helper()
	now := GetDBTimestamp()
	sub := &UserSubscription{
		UserId:          userId,
		PlanId:          plan.Id,
		AmountTotal:     plan.TotalAmount,
		BasicTokenTotal: plan.BasicTokenTotal,
		PaidMoney:       plan.PriceAmount,
		StartTime:       now,
		EndTime:         now + 30*86400,
		Status:          "active",
		Source:          "admin",
	}
	require.NoError(t, DB.Create(sub).Error)
	return sub
}

func TestPreConsumeDualBucketIsolation(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 101, 10000, 500)
	sub := insertActiveSubscription(t, 1, plan)

	// premium 扣 3000,不动 basic
	res, err := PreConsumeUserSubscription("req-premium-1", 1, "gpt-5.5", BucketPremium, 3000, 0)
	require.NoError(t, err)
	require.Equal(t, BucketPremium, res.Bucket)
	require.Equal(t, int64(3000), res.AmountUsedAfter)

	// basic 扣 200,不动 premium
	res2, err := PreConsumeUserSubscription("req-basic-1", 1, "basic-model", BucketBasic, 200, 0)
	require.NoError(t, err)
	require.Equal(t, BucketBasic, res2.Bucket)
	require.Equal(t, int64(200), res2.AmountUsedAfter)

	var got UserSubscription
	require.NoError(t, DB.First(&got, sub.Id).Error)
	require.Equal(t, int64(3000), got.AmountUsed)
	require.Equal(t, int64(200), got.BasicTokenUsed)
}

func TestPreConsumeBasicBucketSemantics(t *testing.T) {
	truncateTables(t)

	// basic=0 → 无基础桶,拒绝
	planNone := insertDualBucketPlan(t, 102, 10000, 0)
	insertActiveSubscription(t, 2, planNone)
	_, err := PreConsumeUserSubscription("req-none", 2, "m", BucketBasic, 1, 0)
	require.ErrorIs(t, err, ErrSubscriptionQuotaInsufficient)

	// basic=-1 → 无限,任意量放行且用量累加
	planUnlimited := insertDualBucketPlan(t, 103, 10000, BasicTokenUnlimited)
	subU := insertActiveSubscription(t, 3, planUnlimited)
	res, err := PreConsumeUserSubscription("req-unlimited", 3, "m", BucketBasic, 1_000_000, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1_000_000), res.PreConsumed)
	var got UserSubscription
	require.NoError(t, DB.First(&got, subU.Id).Error)
	require.Equal(t, int64(1_000_000), got.BasicTokenUsed)

	// 有限桶余量不足 → 拒绝
	planSmall := insertDualBucketPlan(t, 104, 10000, 100)
	insertActiveSubscription(t, 4, planSmall)
	_, err = PreConsumeUserSubscription("req-small", 4, "m", BucketBasic, 101, 0)
	require.ErrorIs(t, err, ErrSubscriptionQuotaInsufficient)
}

func TestPreConsumeIdempotentByRequestId(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 105, 10000, 500)
	sub := insertActiveSubscription(t, 5, plan)

	res1, err := PreConsumeUserSubscription("req-idem", 5, "m", BucketBasic, 100, 0)
	require.NoError(t, err)
	// 同 requestId 重放:不再扣,返回原值,桶标识来自记录
	res2, err := PreConsumeUserSubscription("req-idem", 5, "m", BucketBasic, 100, 0)
	require.NoError(t, err)
	require.Equal(t, res1.UserSubscriptionId, res2.UserSubscriptionId)
	require.Equal(t, BucketBasic, res2.Bucket)

	var got UserSubscription
	require.NoError(t, DB.First(&got, sub.Id).Error)
	require.Equal(t, int64(100), got.BasicTokenUsed)
}

func TestRefundRoutesToOriginalBucket(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 106, 10000, 500)
	sub := insertActiveSubscription(t, 6, plan)

	_, err := PreConsumeUserSubscription("req-refund-basic", 6, "m", BucketBasic, 300, 0)
	require.NoError(t, err)
	// premium 同时有用量,验证退款不串桶
	_, err = PreConsumeUserSubscription("req-refund-premium", 6, "m", BucketPremium, 2000, 0)
	require.NoError(t, err)

	require.NoError(t, RefundSubscriptionPreConsume("req-refund-basic"))

	var got UserSubscription
	require.NoError(t, DB.First(&got, sub.Id).Error)
	require.Equal(t, int64(0), got.BasicTokenUsed, "basic 应回冲")
	require.Equal(t, int64(2000), got.AmountUsed, "premium 不受影响")

	// 退款幂等
	require.NoError(t, RefundSubscriptionPreConsume("req-refund-basic"))
	// 已退款的 requestId 再预扣应报错
	_, err = PreConsumeUserSubscription("req-refund-basic", 6, "m", BucketBasic, 1, 0)
	require.True(t, errors.Is(err, ErrSubscriptionPreConsumeRefunded))
}

func TestPostConsumeDeltaPerBucket(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 107, 1000, 500)
	sub := insertActiveSubscription(t, 7, plan)

	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, BucketPremium, 400))
	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, BucketBasic, 250))

	var got UserSubscription
	require.NoError(t, DB.First(&got, sub.Id).Error)
	require.Equal(t, int64(400), got.AmountUsed)
	require.Equal(t, int64(250), got.BasicTokenUsed)

	// 有限桶不允许超总量
	err := PostConsumeUserSubscriptionDelta(sub.Id, BucketBasic, 300)
	require.Error(t, err)

	// 负 delta 截到 0
	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, BucketBasic, -9999))
	require.NoError(t, DB.First(&got, sub.Id).Error)
	require.Equal(t, int64(0), got.BasicTokenUsed)
}

func TestResetClearsBothBuckets(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 108, 1000, 500)
	plan.QuotaResetPeriod = SubscriptionResetDaily
	require.NoError(t, DB.Save(plan).Error)

	now := GetDBTimestamp()
	sub := &UserSubscription{
		UserId: 8, PlanId: plan.Id,
		AmountTotal: 1000, AmountUsed: 700,
		BasicTokenTotal: 500, BasicTokenUsed: 300,
		StartTime: now - 3*86400, EndTime: now + 27*86400,
		Status:        "active",
		LastResetTime: now - 3*86400,
		NextResetTime: now - 86400, // 已过期,应触发重置
	}
	require.NoError(t, DB.Create(sub).Error)

	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		return maybeResetUserSubscriptionWithPlanTx(tx, sub, plan, now)
	}))
	require.Equal(t, int64(0), sub.AmountUsed)
	require.Equal(t, int64(0), sub.BasicTokenUsed)
}

func TestCalcSubscriptionBalanceQuotaCNY(t *testing.T) {
	// ¥9.9 应折算为 9.9/汇率 美元再乘 QuotaPerUnit,而不是按 $9.9 直扣
	quota, err := calcSubscriptionBalanceQuota(9.9)
	require.NoError(t, err)
	require.Greater(t, quota, 0)
	require.Less(t, quota, int(9.9*500000), "必须小于按美元口径的错误值")
}
