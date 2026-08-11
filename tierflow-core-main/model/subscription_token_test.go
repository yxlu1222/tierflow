package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 套餐专用 Key:签发、定向扣费、生命周期联动、配额豁免。

func createSubViaTx(t *testing.T, userId int, plan *SubscriptionPlan) *UserSubscription {
	t.Helper()
	var sub *UserSubscription
	require.NoError(t, DB.Transaction(func(tx *gorm.DB) error {
		s, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, "admin")
		sub = s
		return err
	}))
	return sub
}

func TestSubscriptionKeyIssueAndLifecycle(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 201, 10000, 500)

	sub := createSubViaTx(t, 31, plan)
	require.NotEmpty(t, sub.IssuedTokenKey, "创建订阅应返回签发的 Key")

	var token Token
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&token).Error)
	require.Equal(t, 31, token.UserId)
	require.True(t, token.UnlimitedQuota, "套餐 Key 的 token 额度不作闸门")
	require.Equal(t, sub.EndTime, token.ExpiredTime, "Key 过期时间对齐订阅")
	require.Equal(t, common.TokenStatusEnabled, token.Status)

	// 配额豁免:套餐 Key 不计入用户令牌数
	count, err := CountUserTokens(31)
	require.NoError(t, err)
	require.Equal(t, int64(0), count)

	// 用户不可删除套餐 Key
	require.Error(t, DeleteTokenById(token.Id, 31))

	// 作废订阅 → Key 联动禁用
	_, err = AdminInvalidateUserSubscription(sub.Id)
	require.NoError(t, err)
	require.NoError(t, DB.First(&token, token.Id).Error)
	require.Equal(t, common.TokenStatusDisabled, token.Status)
}

func TestDirectedPreConsume(t *testing.T) {
	truncateTables(t)
	plan := insertDualBucketPlan(t, 202, 10000, 0)

	subA := createSubViaTx(t, 32, plan)
	subB := createSubViaTx(t, 32, plan)

	// 定向到 B:即使 A 到期更早(遍历序在前),也必须扣 B
	res, err := PreConsumeUserSubscription("req-directed", 32, "m", BucketPremium, 100, subB.Id)
	require.NoError(t, err)
	require.Equal(t, subB.Id, res.UserSubscriptionId)

	var gotA, gotB UserSubscription
	require.NoError(t, DB.First(&gotA, subA.Id).Error)
	require.NoError(t, DB.First(&gotB, subB.Id).Error)
	require.Equal(t, int64(0), gotA.AmountUsed)
	require.Equal(t, int64(100), gotB.AmountUsed)

	// 定向到已作废的订阅 → 无可用订阅,不回退到其他订阅
	_, err = AdminInvalidateUserSubscription(subB.Id)
	require.NoError(t, err)
	_, err = PreConsumeUserSubscription("req-directed-2", 32, "m", BucketPremium, 100, subB.Id)
	require.ErrorIs(t, err, ErrNoActiveSubscription)
}
