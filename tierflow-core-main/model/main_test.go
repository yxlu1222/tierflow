package model

import (
	"os"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	DB = db
	LOG_DB = db

	common.UsingSQLite = true
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false
	common.LogConsumeEnabled = true
	initCol()

	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	if err := db.AutoMigrate(
		&User{},
		&Token{},
		&Log{},
		&Channel{},
		&Ability{},
		&TopUp{},
		&Redemption{},
		&SubscriptionPlan{},
		&SubscriptionOrder{},
		&UserSubscription{},
		&SubscriptionPreConsumeRecord{},
		&PerfMetric{},
	); err != nil {
		panic("failed to migrate: " + err.Error())
	}

	os.Exit(m.Run())
}

func truncateTables(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		DB.Exec("DELETE FROM users")
		DB.Exec("DELETE FROM tokens")
		DB.Exec("DELETE FROM logs")
		DB.Exec("DELETE FROM channels")
		DB.Exec("DELETE FROM abilities")
		DB.Exec("DELETE FROM top_ups")
		DB.Exec("DELETE FROM redemptions")
		DB.Exec("DELETE FROM subscription_orders")
		DB.Exec("DELETE FROM subscription_plans")
		DB.Exec("DELETE FROM user_subscriptions")
		DB.Exec("DELETE FROM subscription_pre_consume_records")
		DB.Exec("DELETE FROM perf_metrics")
	})
}
