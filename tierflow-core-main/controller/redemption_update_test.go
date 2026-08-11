package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupRedemptionUpdateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gin.SetMode(gin.TestMode)
	common.UsingSQLite = true
	common.UsingMySQL = false
	common.UsingPostgreSQL = false
	common.RedisEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	model.LOG_DB = db
	require.NoError(t, db.AutoMigrate(&model.Redemption{}, &model.SubscriptionPlan{}))
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func putRedemption(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPut, "/api/redemption/", strings.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	UpdateRedemption(ctx)
	return recorder
}

// 只改名的 PUT 不得把请求体里没写的字段清零。
//
// 绑定到零值结构体时,省略 type 会绑成 0(=额度码),省略 plan_id/quota/expired_time 同理,
// 而 Redemption.Update() 的 Select 白名单会把零值一并强写进库 —— 一张订阅码就被静默
// 改写成面额 0 的额度码,管理端显示「额度码 ¥0.00」,兑换它的用户既拿不到订阅也拿不到
// 余额,而码照样被消耗。
func TestUpdateRedemptionPartialBodyKeepsOmittedFields(t *testing.T) {
	db := setupRedemptionUpdateTestDB(t)

	plan := &model.SubscriptionPlan{Title: "Pro", PriceAmount: 69.9, Enabled: true}
	require.NoError(t, db.Create(plan).Error)

	r := &model.Redemption{
		Key:         "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr1",
		Name:        "旧名字",
		Status:      common.RedemptionCodeStatusEnabled,
		Type:        common.RedemptionTypeSubscription,
		PlanId:      plan.Id,
		Quota:       0,
		ExpiredTime: 4102415999, // 2099-12-31
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(r).Error)

	rec := putRedemption(t, fmt.Sprintf(`{"id":%d,"name":"新名字"}`, r.Id))
	require.Equal(t, http.StatusOK, rec.Code)

	var after model.Redemption
	require.NoError(t, db.First(&after, r.Id).Error)
	require.Equal(t, "新名字", after.Name, "写了的字段要生效")
	require.Equal(t, common.RedemptionTypeSubscription, after.Type, "省略 type 不能把订阅码改写成额度码")
	require.Equal(t, plan.Id, after.PlanId, "省略 plan_id 不能解绑套餐")
	require.Equal(t, int64(4102415999), after.ExpiredTime, "省略 expired_time 不能清零过期时间")
}

// 显式写入的字段仍然照常生效（确认上面的种子绑定没有把更新变成只读）。
func TestUpdateRedemptionExplicitFieldsStillApply(t *testing.T) {
	db := setupRedemptionUpdateTestDB(t)

	r := &model.Redemption{
		Key:         "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr2",
		Name:        "旧名字",
		Status:      common.RedemptionCodeStatusEnabled,
		Type:        common.RedemptionTypeQuota,
		Quota:       100,
		CreatedTime: common.GetTimestamp(),
	}
	require.NoError(t, db.Create(r).Error)

	rec := putRedemption(t, fmt.Sprintf(`{"id":%d,"name":"新名字","quota":500,"expired_time":0}`, r.Id))
	require.Equal(t, http.StatusOK, rec.Code)

	var after model.Redemption
	require.NoError(t, db.First(&after, r.Id).Error)
	require.Equal(t, "新名字", after.Name)
	require.Equal(t, 500, after.Quota)
	require.Equal(t, common.RedemptionTypeQuota, after.Type)
	require.Equal(t, int64(0), after.ExpiredTime, "显式写 0 表示永不过期，要能写进去")
}
