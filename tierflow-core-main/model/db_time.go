package model

import (
	"github.com/Zer0Echo/tierflow-core/common"

	"gorm.io/gorm"
)

// GetDBTimestamp returns a UNIX timestamp from database time.
// Falls back to application time on error.
func GetDBTimestamp() int64 {
	return getDBTimestampWith(DB)
}

// GetDBTimestampTx 在调用方事务内取数据库时间。
// ⚠️ 事务内必须用本函数而不是 GetDBTimestamp():后者走全局 DB 连接池,
// 在事务持有连接时(小连接池/SQLite 单连接)会死锁。
func GetDBTimestampTx(tx *gorm.DB) int64 {
	if tx == nil {
		return GetDBTimestamp()
	}
	return getDBTimestampWith(tx)
}

func getDBTimestampWith(db *gorm.DB) int64 {
	var ts int64
	var err error
	switch {
	case common.UsingPostgreSQL:
		err = db.Raw("SELECT EXTRACT(EPOCH FROM NOW())::bigint").Scan(&ts).Error
	case common.UsingSQLite:
		err = db.Raw("SELECT strftime('%s','now')").Scan(&ts).Error
	default:
		err = db.Raw("SELECT UNIX_TIMESTAMP()").Scan(&ts).Error
	}
	if err != nil || ts <= 0 {
		return common.GetTimestamp()
	}
	return ts
}
