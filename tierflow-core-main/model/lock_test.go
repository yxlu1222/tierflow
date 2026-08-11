package model

import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type lockProbeRow struct {
	Id   int `gorm:"primaryKey"`
	Name string
}

func (lockProbeRow) TableName() string { return "lock_probe_rows" }

func openLockProbeDB(t *testing.T) *gorm.DB {
	t.Helper()
	// 每个用例独占一个内存库,避免 cache=shared 让用例之间撞主键。
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&lockProbeRow{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Create(&lockProbeRow{Id: 1, Name: "probe"}).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	return db
}

// TestLockForUpdateAttachesLockingClause 锁定 lockForUpdate 真的把 clause.Locking
// 挂到了语句上。这是它存在的全部意义:被它替换掉的
// tx.Set("gorm:query_option", "FOR UPDATE") 在 GORM v2 下只是往 Settings 里塞了个
// 没人读的键,语句上不会有任何锁子句——若谁改回那个写法,这里会立刻失败。
//
// 断言的是 clause 是否挂载(方言无关),不是渲染出的 SQL 文本:
// MySQL / PostgreSQL 会把它渲染成 FOR UPDATE,SQLite 则静默丢弃(见下一个用例)。
func TestLockForUpdateAttachesLockingClause(t *testing.T) {
	db := openLockProbeDB(t)

	var row lockProbeRow
	stmt := lockForUpdate(db.Session(&gorm.Session{DryRun: true})).
		Where("id = ?", 1).Find(&row).Statement

	c, ok := stmt.Clauses[lockingClauseName]
	if !ok {
		t.Fatalf("no locking clause attached; statement clauses: %v", clauseNames(stmt))
	}
	locking, ok := c.Expression.(clause.Locking)
	if !ok {
		t.Fatalf("clause %q is %T, want clause.Locking", lockingClauseName, c.Expression)
	}
	if !strings.EqualFold(locking.Strength, "UPDATE") {
		t.Fatalf("locking strength = %q, want UPDATE", locking.Strength)
	}
}

// TestNoLegacyQueryOptionLock 防止 GORM v1 的死写法长回来。
// tx.Set("gorm:query_option", "FOR UPDATE") 在 GORM v2 下不产生任何锁,
// 但它看起来完全像是加了锁 —— 这正是它危险的地方,review 很难发现。
// 一律走 lockForUpdate。
func TestNoLegacyQueryOptionLock(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read package dir: %v", err)
	}

	const deadIdiom = `"gorm:query_option"`
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") {
			continue
		}
		// lock.go / lock_test.go 提到该字符串是为了说明它为什么不能用。
		if entry.Name() == "lock.go" || entry.Name() == "lock_test.go" {
			continue
		}
		src, err := os.ReadFile(entry.Name())
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		if strings.Contains(string(src), deadIdiom) {
			t.Errorf("%s uses %s, which is a no-op in GORM v2; use lockForUpdate(tx) instead",
				entry.Name(), deadIdiom)
		}
	}
}

// lockingClauseName 是 clause.Locking 在 Statement.Clauses 中的键。
var lockingClauseName = clause.Locking{}.Name()

func clauseNames(stmt *gorm.Statement) []string {
	names := make([]string, 0, len(stmt.Clauses))
	for name := range stmt.Clauses {
		names = append(names, name)
	}
	return names
}

// TestLockForUpdateRunsOnSQLite 固定 Rule 2 的跨库约束:SQLite 上带锁查询必须能执行。
// 当前 glebarez/sqlite 的 dialector 不注册 Locking 子句构建器,会把它静默丢弃
// (SQLite 写事务本身库级串行,无需行锁)。若换驱动后 SQLite 开始拒绝 FOR UPDATE,
// 本用例会失败,届时需要在 lockForUpdate 里按 common.UsingSQLite 跳过加锁。
func TestLockForUpdateRunsOnSQLite(t *testing.T) {
	db := openLockProbeDB(t)

	err := db.Transaction(func(tx *gorm.DB) error {
		var row lockProbeRow
		return lockForUpdate(tx).Where("id = ?", 1).First(&row).Error
	})
	if err != nil {
		t.Fatalf("locked read must work on SQLite, got: %v", err)
	}
}
