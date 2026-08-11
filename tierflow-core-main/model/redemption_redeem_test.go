package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/stretchr/testify/require"
)

func newQuotaRedemption(t *testing.T, key string, quota int) *Redemption {
	t.Helper()
	r := &Redemption{
		UserId:      1,
		Key:         key,
		Name:        "t",
		Quota:       quota,
		Status:      common.RedemptionCodeStatusEnabled,
		Type:        common.RedemptionTypeQuota,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(r).Error)
	return r
}

// 兑换目标账号被软删除时，额度 UPDATE 会因 GORM 自动追加 `deleted_at IS NULL` 而影响 0 行
// 且不报错。若不查 RowsAffected，事务会一路把兑换码置为 Used —— 用户被告知兑换成功、
// 额度零到账、码被永久烧掉，而管理端的状态回退守卫又禁止把 Used 改回 Enabled，无从补救。
func TestRedeemQuotaRejectsSoftDeletedUser(t *testing.T) {
	truncateTables(t)

	u := &User{Username: "gone-user", Password: "x", Quota: 0}
	require.NoError(t, DB.Create(u).Error)
	require.NoError(t, DB.Delete(u).Error) // 软删除：行还在，deleted_at 非空

	r := newQuotaRedemption(t, "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk1", 500)

	_, err := Redeem(r.Key, u.Id)
	require.Error(t, err, "兑换给已软删除的账号必须失败")

	// 兑换码必须整体回滚、保持可用
	var after Redemption
	require.NoError(t, DB.First(&after, r.Id).Error)
	require.Equal(t, common.RedemptionCodeStatusEnabled, after.Status, "码不能被烧掉")
	require.Zero(t, after.UsedUserId)
	require.Zero(t, after.RedeemedTime)
}

// 正常账号的对照组：确认上面的守卫没有误伤正常兑换。
func TestRedeemQuotaCreditsLiveUser(t *testing.T) {
	truncateTables(t)

	u := &User{Username: "live-user", Password: "x", Quota: 10}
	require.NoError(t, DB.Create(u).Error)

	r := newQuotaRedemption(t, "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk2", 500)

	res, err := Redeem(r.Key, u.Id)
	require.NoError(t, err)
	require.Equal(t, common.RedemptionTypeQuota, res.Type)
	require.Equal(t, 500, res.Quota)

	var after User
	require.NoError(t, DB.First(&after, u.Id).Error)
	require.Equal(t, 510, after.Quota)

	var used Redemption
	require.NoError(t, DB.First(&used, r.Id).Error)
	require.Equal(t, common.RedemptionCodeStatusUsed, used.Status)
	require.Equal(t, u.Id, used.UsedUserId)
}
