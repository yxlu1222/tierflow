package model

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// lockForUpdate 给事务内的查询加行级写锁(SELECT ... FOR UPDATE)。
//
// 存在的理由:GORM v2 移除了 v1 的 tx.Set("gorm:query_option", "FOR UPDATE") 写法,
// 该 Setting 不再被任何 callback 消费,等同于没加锁——用它写出来的并发保护全是假的。
// 走 clause.Locking 才真正生效。集中到这里是为了不让那个坏写法再长回来。
//
// 跨库(Rule 2):MySQL / PostgreSQL 正常发出 FOR UPDATE;SQLite 的 dialector
// 不注册 Locking 子句构建器,会静默丢弃它,发出的仍是普通 SELECT——SQLite 的写事务
// 本身就是库级串行的,没有行锁也不存在并发改写。见 lock_test.go。
func lockForUpdate(tx *gorm.DB) *gorm.DB {
	return tx.Clauses(clause.Locking{Strength: "UPDATE"})
}
