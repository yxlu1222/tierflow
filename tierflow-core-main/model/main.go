package model

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

var commonGroupCol string
var commonKeyCol string
var commonTrueVal string
var commonFalseVal string

var logKeyCol string
var logGroupCol string

func initCol() {
	// init common column names
	if common.UsingPostgreSQL {
		commonGroupCol = `"group"`
		commonKeyCol = `"key"`
		commonTrueVal = "true"
		commonFalseVal = "false"
	} else {
		commonGroupCol = "`group`"
		commonKeyCol = "`key`"
		commonTrueVal = "1"
		commonFalseVal = "0"
	}
	if os.Getenv("LOG_SQL_DSN") != "" {
		switch common.LogSqlType {
		case common.DatabaseTypePostgreSQL:
			logGroupCol = `"group"`
			logKeyCol = `"key"`
		default:
			logGroupCol = commonGroupCol
			logKeyCol = commonKeyCol
		}
	} else {
		// LOG_SQL_DSN 为空时，日志数据库与主数据库相同
		if common.UsingPostgreSQL {
			logGroupCol = `"group"`
			logKeyCol = `"key"`
		} else {
			logGroupCol = commonGroupCol
			logKeyCol = commonKeyCol
		}
	}
	// log sql type and database type
	//common.SysLog("Using Log SQL Type: " + common.LogSqlType)
}

var DB *gorm.DB

var LOG_DB *gorm.DB

func createRootAccountIfNeed() error {
	var user User
	//if user.Status != common.UserStatusEnabled {
	if err := DB.First(&user).Error; err != nil {
		common.SysLog("no user exists, create a root user for you: username is root, password is 123456")
		hashedPassword, err := common.Password2Hash("123456")
		if err != nil {
			return err
		}
		rootUser := User{
			Username:    "root",
			Password:    hashedPassword,
			Role:        common.RoleRootUser,
			Status:      common.UserStatusEnabled,
			DisplayName: "Root User",
			AccessToken: nil,
			Quota:       100000000,
		}
		DB.Create(&rootUser)
	}
	return nil
}

func CheckSetup() {
	setup := GetSetup()
	if setup == nil {
		// No setup record exists, check if we have a root user
		if RootUserExists() {
			common.SysLog("system is not initialized, but root user exists")
			// Create setup record
			newSetup := Setup{
				Version:       common.Version,
				InitializedAt: time.Now().Unix(),
			}
			err := DB.Create(&newSetup).Error
			if err != nil {
				common.SysLog("failed to create setup record: " + err.Error())
			}
			constant.Setup = true
		} else {
			common.SysLog("system is not initialized and no root user exists")
			constant.Setup = false
		}
	} else {
		// Setup record exists, system is initialized
		common.SysLog("system is already initialized at: " + time.Unix(setup.InitializedAt, 0).String())
		constant.Setup = true
	}
}

func chooseDB(envName string, isLog bool) (*gorm.DB, error) {
	defer func() {
		initCol()
	}()
	dsn := os.Getenv(envName)
	if dsn != "" {
		if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
			// Use PostgreSQL
			common.SysLog("using PostgreSQL as database")
			if !isLog {
				common.UsingPostgreSQL = true
			} else {
				common.LogSqlType = common.DatabaseTypePostgreSQL
			}
			return gorm.Open(postgres.New(postgres.Config{
				DSN:                  dsn,
				PreferSimpleProtocol: true, // disables implicit prepared statement usage
			}), &gorm.Config{
				PrepareStmt: true, // precompile SQL
			})
		}
		if strings.HasPrefix(dsn, "local") {
			common.SysLog("SQL_DSN not set, using SQLite as database")
			if !isLog {
				common.UsingSQLite = true
			} else {
				common.LogSqlType = common.DatabaseTypeSQLite
			}
			return gorm.Open(sqlite.Open(common.SQLitePath), &gorm.Config{
				PrepareStmt: true, // precompile SQL
			})
		}
		// Use MySQL
		common.SysLog("using MySQL as database")
		// check parseTime
		if !strings.Contains(dsn, "parseTime") {
			if strings.Contains(dsn, "?") {
				dsn += "&parseTime=true"
			} else {
				dsn += "?parseTime=true"
			}
		}
		if !isLog {
			common.UsingMySQL = true
		} else {
			common.LogSqlType = common.DatabaseTypeMySQL
		}
		return gorm.Open(mysql.Open(dsn), &gorm.Config{
			PrepareStmt: true, // precompile SQL
		})
	}
	// Use SQLite
	common.SysLog("SQL_DSN not set, using SQLite as database")
	common.UsingSQLite = true
	return gorm.Open(sqlite.Open(common.SQLitePath), &gorm.Config{
		PrepareStmt: true, // precompile SQL
	})
}

func InitDB() (err error) {
	db, err := chooseDB("SQL_DSN", false)
	if err == nil {
		if common.DebugEnabled {
			db = db.Debug()
		}
		DB = db
		// MySQL charset/collation startup check: ensure Chinese-capable charset
		if common.UsingMySQL {
			if err := checkMySQLChineseSupport(DB); err != nil {
				panic(err)
			}
		}
		sqlDB, err := DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		if common.UsingMySQL {
			//_, _ = sqlDB.Exec("ALTER TABLE channels MODIFY model_mapping TEXT;") // TODO: delete this line when most users have upgraded
		}
		common.SysLog("database migration started")
		err = migrateDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

func InitLogDB() (err error) {
	if os.Getenv("LOG_SQL_DSN") == "" {
		LOG_DB = DB
		return
	}
	db, err := chooseDB("LOG_SQL_DSN", true)
	if err == nil {
		if common.DebugEnabled {
			db = db.Debug()
		}
		LOG_DB = db
		// If log DB is MySQL, also ensure Chinese-capable charset
		if common.LogSqlType == common.DatabaseTypeMySQL {
			if err := checkMySQLChineseSupport(LOG_DB); err != nil {
				panic(err)
			}
		}
		sqlDB, err := LOG_DB.DB()
		if err != nil {
			return err
		}
		sqlDB.SetMaxIdleConns(common.GetEnvOrDefault("SQL_MAX_IDLE_CONNS", 100))
		sqlDB.SetMaxOpenConns(common.GetEnvOrDefault("SQL_MAX_OPEN_CONNS", 1000))
		sqlDB.SetConnMaxLifetime(time.Second * time.Duration(common.GetEnvOrDefault("SQL_MAX_LIFETIME", 60)))

		if !common.IsMasterNode {
			return nil
		}
		common.SysLog("database migration started")
		err = migrateLOGDB()
		return err
	} else {
		common.FatalLog(err)
	}
	return err
}

func migrateDB() error {
	// Migrate price_amount column from float/double to decimal for existing tables
	migrateSubscriptionPlanPriceAmount()
	// Migrate model_limits column from varchar to text for existing tables
	if err := migrateTokenModelLimitsToText(); err != nil {
		return err
	}
	// Drop the pre-channel_id perf_metrics unique index so AutoMigrate can
	// create the new channel-scoped one (see migratePerfMetricUniqueIndex).
	if err := migratePerfMetricUniqueIndex(); err != nil {
		return err
	}
	// Add users.uid without its unique constraint so AutoMigrate only has to
	// create the index (see ensureUserUidColumn).
	if err := ensureUserUidColumn(); err != nil {
		return err
	}

	err := DB.AutoMigrate(
		&Channel{},
		&Token{},
		&User{},
		&PasskeyCredential{},
		&Option{},
		&Redemption{},
		&Ability{},
		&Log{},
		// ⚠️ ConversationIndex 与 Log 同属"日志库"，因此和 Log 一样必须挂在**两处**：
		// 未设 LOG_SQL_DSN(默认)时 InitLogDB 直接 `LOG_DB = DB` 就 return、
		// migrateLOGDB 压根不跑，只挂那一处会在默认形态下静默不建表。
		&ConversationIndex{},
		&TopUp{},
		&QuotaData{},
		&Model{},
		&Vendor{},
		&PrefillGroup{},
		&Setup{},
		&TwoFA{},
		&TwoFABackupCode{},
		&Checkin{},
		&SubscriptionOrder{},
		&UserSubscription{},
		&SubscriptionPreConsumeRecord{},
		&CustomOAuthProvider{},
		&UserOAuthBinding{},
		&PerfMetric{},
		&RoutingProfile{},
		&ModelGroup{},
		&ModelGroupMember{},
		&PlanModelSet{},
		&PlanModelSetMember{},
		&Ticket{},
		&TicketMessage{},
	)
	if err != nil {
		return err
	}
	if common.UsingSQLite {
		if err := ensureSubscriptionPlanTableSQLite(); err != nil {
			return err
		}
	} else {
		if err := DB.AutoMigrate(&SubscriptionPlan{}); err != nil {
			return err
		}
	}
	dropRemovedSubscriptionPlanColumns()
	if err := cleanupObsoleteOptions(); err != nil {
		return err
	}
	if err := backfillTicketNumbers(); err != nil {
		return err
	}
	if err := backfillUserUids(); err != nil {
		return err
	}
	// logs 与主库同库时(未设 LOG_SQL_DSN,默认形态)Log 就是在上面这次
	// AutoMigrate 里迁移的,所以重复索引的清理也必须挂在这里 —— 只挂 migrateLOGDB
	// 会漏掉默认形态,那个函数在 InitLogDB 里被早退跳过了。
	if err := migrateLogStrategyIndex(DB); err != nil {
		return err
	}
	return nil
}

// ensureUserUidColumn adds users.uid ahead of AutoMigrate, deliberately without
// the UNIQUE constraint.
//
// SQLite rejects "ALTER TABLE ... ADD COLUMN ... UNIQUE" outright ("Cannot add a
// UNIQUE column"), which is what AutoMigrate emits for a uniqueIndex-tagged
// field being added to a table that already exists. Adding the bare column here
// leaves AutoMigrate with nothing to do but CREATE UNIQUE INDEX, which all three
// databases accept. Every existing row is NULL at that point, and NULL never
// collides in a unique index, so the index builds cleanly before backfill runs.
//
// No-op on a fresh database: the table does not exist yet and AutoMigrate will
// create the column with its constraint inline, which is fine.
func ensureUserUidColumn() error {
	migrator := DB.Migrator()
	if !migrator.HasTable(&User{}) {
		return nil
	}
	if migrator.HasColumn(&User{}, "uid") {
		return nil
	}
	// The column name must be quoted in the dialect's own style: GORM's SQLite
	// migrator locates fields by regex-parsing the stored CREATE TABLE DDL, and
	// an unquoted name added by ALTER is invisible to it ("failed to look up
	// field uid from DDL").
	uidCol := "`uid`"
	if common.UsingPostgreSQL {
		uidCol = `"uid"`
	}
	if err := DB.Exec("ALTER TABLE users ADD COLUMN " + uidCol + " varchar(12)").Error; err != nil {
		return err
	}
	common.SysLog("added users.uid column")
	return nil
}

// isDuplicateKeyError reports whether err is a unique-constraint violation.
//
// GORM only maps these to gorm.ErrDuplicatedKey when the dialector is opened
// with TranslateError, which this project does not do (see chooseDB), so the
// driver's own message is the only signal available. Each of the three
// supported databases words it differently.
func isDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || // SQLite, PostgreSQL
		strings.Contains(msg, "duplicate key") || // PostgreSQL
		strings.Contains(msg, "duplicate entry") // MySQL
}

// backfillUserUids assigns a public-facing uid to every user row that predates
// the uid column. Idempotent — only touches rows whose uid is still NULL, so it
// is safe to re-run on every startup.
//
// Unlike backfillTicketNumbers, uid is random rather than derived from the id
// (a derived value would still leak signup order, which is the whole point of
// having a uid). That has three consequences this function must handle:
//
//   - Batched rather than loading the whole table: users can be far more
//     numerous than tickets, and the candidate set shrinks each round.
//   - The UPDATE re-checks "uid IS NULL" so a concurrent writer or a re-run can
//     never overwrite an already-assigned uid.
//   - A duplicate-key collision is skipped rather than fatal; the row stays in
//     the candidate set and gets a fresh uid next round. Each statement runs on
//     the bare DB handle, never inside a transaction — on PostgreSQL a
//     duplicate inside a transaction would abort the whole batch.
//
// Unscoped: soft-deleted users still occupy the unique index, so they need a
// uid too.
func backfillUserUids() error {
	const batchSize = 500
	for {
		// Only the ids are needed. Selecting whole User rows would pull every
		// column — including password hashes, access tokens and the setting
		// blob — into memory just to read Id.
		var ids []int
		if err := DB.Unscoped().Model(&User{}).
			Where("uid IS NULL OR uid = ?", "").
			Limit(batchSize).Pluck("id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}

		// Fast path: one transaction per batch, so the writes cost one commit
		// (one fsync) instead of one per row.
		err := DB.Transaction(func(tx *gorm.DB) error {
			for _, id := range ids {
				if err := assignUidTo(tx, id); err != nil {
					return err
				}
			}
			return nil
		})
		if err == nil {
			continue
		}
		// A duplicate anywhere in the batch aborts the whole transaction
		// (mandatory on PostgreSQL), so fall back to row-at-a-time for this
		// batch and let only the colliding rows retry. At ~1e-8 per row this
		// path is effectively never taken.
		if !isDuplicateKeyError(err) {
			return fmt.Errorf("backfill uid batch: %w", err)
		}
		common.SysLog("backfill user uid: collision inside batch, retrying row by row")
		if err := backfillUserUidsRowByRow(ids); err != nil {
			return err
		}
	}
}

// assignUidTo writes a freshly generated uid to one user row. The WHERE clause
// re-checks that uid is still unset, so a concurrent writer or a re-run can
// never overwrite an already-assigned value.
func assignUidTo(db *gorm.DB, id int) error {
	uid, err := GenerateUid()
	if err != nil {
		return err
	}
	return db.Unscoped().Model(&User{}).
		Where("id = ? AND (uid IS NULL OR uid = ?)", id, "").
		Update("uid", uid).Error
}

// backfillUserUidsRowByRow is the fallback for a batch that hit a uid
// collision. Each row gets its own statement so one collision cannot roll back
// its neighbours; colliding rows are simply left for the next outer round,
// where they draw a different value.
func backfillUserUidsRowByRow(ids []int) error {
	assigned := 0
	for _, id := range ids {
		if err := assignUidTo(DB, id); err != nil {
			// Only a genuine unique-index collision is retryable. Anything else
			// (dropped connection, lock timeout, permissions) must surface
			// as-is: swallowing it here would report a uid collision, which is
			// statistically impossible in a 9e11 space, and hide the real cause.
			if !isDuplicateKeyError(err) {
				return fmt.Errorf("backfill uid for user %d: %w", id, err)
			}
			common.SysLog("backfill user uid collision for id " + strconv.Itoa(id) + ", will retry with a new value")
			continue
		}
		assigned++
	}
	// Every row collided. Non-collision errors have already returned above, so
	// reaching here means something is structurally wrong (e.g. a broken unique
	// index) rather than bad luck.
	if assigned == 0 {
		return errors.New("failed to backfill uid: every row in the batch collided")
	}
	return nil
}

// backfillTicketNumbers assigns a stable, human-facing ticket number to any
// ticket row that predates the ticket_no column (or was left blank). The
// format matches AddTicket's generation (TK + zero-padded id), so old and new
// tickets share one scheme and never collide. Idempotent — only touches rows
// whose ticket_no is still empty, so it is safe to run on every startup.
func backfillTicketNumbers() error {
	var tickets []Ticket
	if err := DB.Where("ticket_no = ? OR ticket_no IS NULL", "").Find(&tickets).Error; err != nil {
		return err
	}
	for _, tk := range tickets {
		no := fmt.Sprintf("TK%06d", tk.Id)
		if err := DB.Model(&Ticket{}).Where("id = ?", tk.Id).Update("ticket_no", no).Error; err != nil {
			return err
		}
	}
	return nil
}

// migratePerfMetricUniqueIndex drops the pre-channel_id unique index on
// perf_metrics. channel_id was later added to the composite unique bucket key
// (now idx_perf_model_group_channel_bucket), but GORM AutoMigrate keys indexes
// by name and will NOT alter the older 3-column idx_perf_model_group_bucket on
// an upgraded database. Left in place, the stale index makes UpsertPerfMetric's
// 4-column ON CONFLICT match no unique index — erroring on PostgreSQL/SQLite
// (all perf persistence halts) or wrongly merging channels on MySQL. Dropping
// the old-named index here lets AutoMigrate create the new one.
//
// Idempotent + cross-DB: GORM's DropIndex emits per-dialect syntax, and once
// the old index is gone HasIndex is false so subsequent startups are a no-op.
// Safe on fresh installs (no table / no old index → skipped). The rename to a
// new index name is what lets this target only the legacy index instead of
// dropping and recreating the current index on every boot.
func migratePerfMetricUniqueIndex() error {
	if !DB.Migrator().HasTable(&PerfMetric{}) {
		return nil
	}
	if DB.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket") {
		if err := DB.Migrator().DropIndex(&PerfMetric{}, "idx_perf_model_group_bucket"); err != nil {
			return err
		}
	}
	return nil
}

// cleanupObsoleteOptions removes option rows for features that were retired:
// the "站点与品牌" slimming (SystemName/Footer/About/HomePageContent/theme.frontend/
// legal.*, now hardcoded on the frontend or removed) and the removed payment
// gateways (Stripe/Creem/Waffo/Waffo Pancake, whose rows include plaintext
// secrets). Deleting the stale rows keeps the options table in sync with the
// code and purges orphaned credentials. Idempotent — safe to run on every startup.
func cleanupObsoleteOptions() error {
	obsoleteKeys := []string{
		"SystemName",
		"Footer",
		"About",
		"HomePageContent",
		"Notice",
		"theme.frontend",
		"legal.user_agreement",
		"legal.privacy_policy",
		"Logo", // 徽标改为前端硬编码后遗留的孤儿行
		// Payment gateways removed in this release (Stripe / Creem / Waffo /
		// Waffo Pancake). Their option rows include plaintext secrets
		// (API/webhook secrets, private keys), so purge them rather than leave
		// orphaned credential material in the options table.
		"StripeApiSecret",
		"StripeWebhookSecret",
		"StripePriceId",
		"StripeUnitPrice",
		"StripeMinTopUp",
		"StripePromotionCodesEnabled",
		"CreemApiKey",
		"CreemProducts",
		"CreemTestMode",
		"CreemWebhookSecret",
		"WaffoEnabled",
		"WaffoApiKey",
		"WaffoPrivateKey",
		"WaffoPublicCert",
		"WaffoSandboxPublicCert",
		"WaffoSandboxApiKey",
		"WaffoSandboxPrivateKey",
		"WaffoSandbox",
		"WaffoMerchantId",
		"WaffoNotifyUrl",
		"WaffoReturnUrl",
		"WaffoSubscriptionReturnUrl",
		"WaffoCurrency",
		"WaffoUnitPrice",
		"WaffoMinTopUp",
		"WaffoPayMethods",
		"WaffoPancakeMerchantID",
		"WaffoPancakePrivateKey",
		"WaffoPancakeReturnURL",
		"WaffoPancakeUnitPrice",
		"WaffoPancakeMinTopUp",
		"WaffoPancakeStoreID",
		"WaffoPancakeProductID",
		// 「控制台内容」设置区整体下线:数据仪表盘(DataExport*)、API地址、常见问答、
		// Uptime Kuma、绘图(Drawing/Mj*)。这些项已从代码删除,对应 option 行成孤儿,一并清除。
		// 注:公告(console_setting.announcements / 旧键 Announcements)属保留功能,不在此列。
		"console_setting.api_info",
		"console_setting.api_info_enabled",
		"console_setting.faq",
		"console_setting.faq_enabled",
		"console_setting.uptime_kuma_groups",
		"console_setting.uptime_kuma_enabled",
		// 旧版遗留键(迁移器已随控制台内容一并删除)
		"ApiInfo",
		"FAQ",
		"UptimeKumaUrl",
		"UptimeKumaSlug",
		// 数据仪表盘导出开关(功能保留、恒开;仅删除可配置性)
		"DataExportEnabled",
		"DataExportInterval",
		"DataExportDefaultTime",
		// 绘图 / Midjourney
		"DrawingEnabled",
		"MjNotifyEnabled",
		"MjAccountFilterEnabled",
		"MjForwardUrlEnabled",
		"MjModeClearEnabled",
		"MjActionCheckSuccessEnabled",
		"Midjourney",
	}
	if err := DB.Where(commonKeyCol+" IN ?", obsoleteKeys).Delete(&Option{}).Error; err != nil {
		return err
	}
	return nil
}

// dropRemovedSubscriptionPlanColumns removes obsolete columns from
// subscription_plans: the per-gateway product/price identifiers
// (stripe_price_id, creem_product_id, waffo_pancake_product_id) left over from
// removed payment gateways, and `currency` — the site is single-currency (CNY,
// see docs/subscription-gap-analysis.md D1) so price_amount is unambiguous and
// the column is dead. Works across SQLite (3.35+), MySQL and PostgreSQL via
// GORM's migrator, is idempotent (only drops columns that still exist), and is
// best-effort: on databases that cannot drop the column the failure is logged
// and the leftover column is left as a harmless orphan instead of aborting
// startup.
func dropRemovedSubscriptionPlanColumns() {
	tableName := "subscription_plans"
	if !DB.Migrator().HasTable(tableName) {
		return
	}
	removedColumns := []string{"stripe_price_id", "creem_product_id", "waffo_pancake_product_id", "currency"}
	for _, col := range removedColumns {
		if !DB.Migrator().HasColumn(&SubscriptionPlan{}, col) {
			continue
		}
		if err := DB.Migrator().DropColumn(&SubscriptionPlan{}, col); err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to drop obsolete column %s.%s (leaving as orphan): %v", tableName, col, err))
		} else {
			common.SysLog(fmt.Sprintf("Dropped obsolete column %s.%s", tableName, col))
		}
	}
}

func migrateLOGDB() error {
	var err error
	if err = LOG_DB.AutoMigrate(&Log{}); err != nil {
		return err
	}
	if err = migrateLogStrategyIndex(LOG_DB); err != nil {
		return err
	}
	// 会话索引与 logs 同库(可由 LOG_SQL_DSN 拆到独立库)
	if err = LOG_DB.AutoMigrate(&ConversationIndex{}); err != nil {
		return err
	}
	return nil
}

// migrateLogStrategyIndex 删掉 idx_logs_strategy —— 一个与 idx_logs_model_name
// 完全同形(都是 logs(model_name) 单列)的重复索引。
//
// 由来:Log.ModelName 改名为 Log.Strategy 时,单列索引标签还是裸 `index`,而 GORM
// 给未命名索引取名走的是 **Go 字段名**而非列名,于是它把索引注册成了
// idx_logs_strategy;AutoMigrate 的 HasIndex 按名字查,查不到就在同一列上又建了一个。
// 标签现已显式钉回 idx_logs_model_name(见 Log.Strategy 注释),所以 AutoMigrate 不会
// 再生成新的,但已经启动过一次的库里那个多余索引还在,得在这里删。
//
// ⚠️ 必须在**两处**调用,因为 logs 表有两条互斥的迁移路径:
//   - 未设 LOG_SQL_DSN(默认):InitLogDB 直接 `LOG_DB = DB` 就 return,
//     migrateLOGDB 压根不跑,Log 是在 migrateDB 的主 AutoMigrate 列表里迁移的;
//   - 设了 LOG_SQL_DSN:logs 独立库,由 migrateLOGDB 迁移。
// 只挂一处会在另一种形态下静默失效 —— 这个函数第一版就只挂了 migrateLOGDB,
// 结果在默认形态下完全没执行。故显式接收 *gorm.DB 而不是读全局。
//
// 幂等 + 三库兼容:GORM 的 DropIndex 按方言生成语法,删掉后 HasIndex 为 false,
// 后续启动是 no-op;全新安装没有这个索引,直接跳过。
func migrateLogStrategyIndex(db *gorm.DB) error {
	if db == nil {
		return nil
	}
	m := db.Migrator()
	if !m.HasTable(&Log{}) {
		return nil
	}
	if !m.HasIndex(&Log{}, "idx_logs_strategy") {
		return nil
	}
	if err := m.DropIndex(&Log{}, "idx_logs_strategy"); err != nil {
		return err
	}
	common.SysLog("Dropped redundant index idx_logs_strategy on logs(model_name)")
	return nil
}

type sqliteColumnDef struct {
	Name string
	DDL  string
}

func ensureSubscriptionPlanTableSQLite() error {
	if !common.UsingSQLite {
		return nil
	}
	tableName := "subscription_plans"
	if !DB.Migrator().HasTable(tableName) {
		createSQL := `CREATE TABLE ` + "`" + tableName + "`" + ` (
` + "`id`" + ` integer,
` + "`title`" + ` varchar(128) NOT NULL,
` + "`subtitle`" + ` varchar(255) DEFAULT '',
` + "`price_amount`" + ` decimal(10,6) NOT NULL,
` + "`duration_unit`" + ` varchar(16) NOT NULL DEFAULT 'month',
` + "`duration_value`" + ` integer NOT NULL DEFAULT 1,
` + "`custom_seconds`" + ` bigint NOT NULL DEFAULT 0,
` + "`enabled`" + ` numeric DEFAULT 1,
` + "`sort_order`" + ` integer DEFAULT 0,
` + "`recommended`" + ` numeric DEFAULT 0,
` + "`allow_balance_pay`" + ` numeric DEFAULT 1,
` + "`max_purchase_per_user`" + ` integer DEFAULT 0,
` + "`upgrade_group`" + ` varchar(64) DEFAULT '',
` + "`total_amount`" + ` bigint NOT NULL DEFAULT 0,
` + "`basic_token_total`" + ` bigint NOT NULL DEFAULT 0,
` + "`premium_set_id`" + ` integer NOT NULL DEFAULT 0,
` + "`basic_set_id`" + ` integer NOT NULL DEFAULT 0,
` + "`quota_reset_period`" + ` varchar(16) DEFAULT 'never',
` + "`quota_reset_custom_seconds`" + ` bigint DEFAULT 0,
` + "`created_at`" + ` bigint,
` + "`updated_at`" + ` bigint,
PRIMARY KEY (` + "`id`" + `)
)`
		return DB.Exec(createSQL).Error
	}
	var cols []struct {
		Name string `gorm:"column:name"`
	}
	if err := DB.Raw("PRAGMA table_info(`" + tableName + "`)").Scan(&cols).Error; err != nil {
		return err
	}
	existing := make(map[string]struct{}, len(cols))
	for _, c := range cols {
		existing[c.Name] = struct{}{}
	}
	required := []sqliteColumnDef{
		{Name: "title", DDL: "`title` varchar(128) NOT NULL"},
		{Name: "subtitle", DDL: "`subtitle` varchar(255) DEFAULT ''"},
		{Name: "price_amount", DDL: "`price_amount` decimal(10,6) NOT NULL"},
		{Name: "duration_unit", DDL: "`duration_unit` varchar(16) NOT NULL DEFAULT 'month'"},
		{Name: "duration_value", DDL: "`duration_value` integer NOT NULL DEFAULT 1"},
		{Name: "custom_seconds", DDL: "`custom_seconds` bigint NOT NULL DEFAULT 0"},
		{Name: "enabled", DDL: "`enabled` numeric DEFAULT 1"},
		{Name: "sort_order", DDL: "`sort_order` integer DEFAULT 0"},
		{Name: "recommended", DDL: "`recommended` numeric DEFAULT 0"},
		{Name: "allow_balance_pay", DDL: "`allow_balance_pay` numeric DEFAULT 1"},
		{Name: "max_purchase_per_user", DDL: "`max_purchase_per_user` integer DEFAULT 0"},
		{Name: "upgrade_group", DDL: "`upgrade_group` varchar(64) DEFAULT ''"},
		{Name: "total_amount", DDL: "`total_amount` bigint NOT NULL DEFAULT 0"},
		{Name: "basic_token_total", DDL: "`basic_token_total` bigint NOT NULL DEFAULT 0"},
		{Name: "premium_set_id", DDL: "`premium_set_id` integer NOT NULL DEFAULT 0"},
		{Name: "basic_set_id", DDL: "`basic_set_id` integer NOT NULL DEFAULT 0"},
		{Name: "quota_reset_period", DDL: "`quota_reset_period` varchar(16) DEFAULT 'never'"},
		{Name: "quota_reset_custom_seconds", DDL: "`quota_reset_custom_seconds` bigint DEFAULT 0"},
		{Name: "created_at", DDL: "`created_at` bigint"},
		{Name: "updated_at", DDL: "`updated_at` bigint"},
	}
	for _, col := range required {
		if _, ok := existing[col.Name]; ok {
			continue
		}
		if err := DB.Exec("ALTER TABLE `" + tableName + "` ADD COLUMN " + col.DDL).Error; err != nil {
			return err
		}
	}
	return nil
}

// migrateTokenModelLimitsToText migrates model_limits column from varchar(1024) to text
// This is safe to run multiple times - it checks the column type first
func migrateTokenModelLimitsToText() error {
	// SQLite uses type affinity, so TEXT and VARCHAR are effectively the same — no migration needed
	if common.UsingSQLite {
		return nil
	}

	tableName := "tokens"
	columnName := "model_limits"

	if !DB.Migrator().HasTable(tableName) {
		return nil
	}

	if !DB.Migrator().HasColumn(&Token{}, columnName) {
		return nil
	}

	var alterSQL string
	if common.UsingPostgreSQL {
		var dataType string
		if err := DB.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE text`, tableName, columnName)
	} else if common.UsingMySQL {
		var columnType string
		if err := DB.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.ToLower(columnType) == "text" {
			return nil
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s text", tableName, columnName)
	} else {
		return nil
	}

	if alterSQL != "" {
		if err := DB.Exec(alterSQL).Error; err != nil {
			return fmt.Errorf("failed to migrate %s.%s to text: %w", tableName, columnName, err)
		}
		common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to text", tableName, columnName))
	}
	return nil
}

// migrateSubscriptionPlanPriceAmount migrates price_amount column from float/double to decimal(10,6)
// This is safe to run multiple times - it checks the column type first
func migrateSubscriptionPlanPriceAmount() {
	// SQLite doesn't support ALTER COLUMN, and its type affinity handles this automatically
	// Skip early to avoid GORM parsing the existing table DDL which may cause issues
	if common.UsingSQLite {
		return
	}

	tableName := "subscription_plans"
	columnName := "price_amount"

	// Check if table exists first
	if !DB.Migrator().HasTable(tableName) {
		return
	}

	// Check if column exists
	if !DB.Migrator().HasColumn(&SubscriptionPlan{}, columnName) {
		return
	}

	var alterSQL string
	if common.UsingPostgreSQL {
		// PostgreSQL: Check if already decimal/numeric
		var dataType string
		if err := DB.Raw(`SELECT data_type FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&dataType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if dataType == "numeric" {
			return // Already decimal/numeric
		}
		alterSQL = fmt.Sprintf(`ALTER TABLE %s ALTER COLUMN %s TYPE decimal(10,6) USING %s::decimal(10,6)`,
			tableName, columnName, columnName)
	} else if common.UsingMySQL {
		// MySQL: Check if already decimal
		var columnType string
		if err := DB.Raw(`SELECT COLUMN_TYPE FROM information_schema.columns
				WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
			tableName, columnName).Scan(&columnType).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to query metadata for %s.%s: %v", tableName, columnName, err))
		} else if strings.HasPrefix(strings.ToLower(columnType), "decimal") {
			return // Already decimal
		}
		alterSQL = fmt.Sprintf("ALTER TABLE %s MODIFY COLUMN %s decimal(10,6) NOT NULL DEFAULT 0",
			tableName, columnName)
	} else {
		return
	}

	if alterSQL != "" {
		if err := DB.Exec(alterSQL).Error; err != nil {
			common.SysLog(fmt.Sprintf("Warning: failed to migrate %s.%s to decimal: %v", tableName, columnName, err))
		} else {
			common.SysLog(fmt.Sprintf("Successfully migrated %s.%s to decimal(10,6)", tableName, columnName))
		}
	}
}

func closeDB(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	err = sqlDB.Close()
	return err
}

func CloseDB() error {
	if LOG_DB != DB {
		err := closeDB(LOG_DB)
		if err != nil {
			return err
		}
	}
	return closeDB(DB)
}

// checkMySQLChineseSupport ensures the MySQL connection and current schema
// default charset/collation can store Chinese characters. It allows common
// Chinese-capable charsets (utf8mb4, utf8, gbk, big5, gb18030) and panics otherwise.
func checkMySQLChineseSupport(db *gorm.DB) error {
	// 仅检测：当前库默认字符集/排序规则 + 各表的排序规则（隐含字符集）

	// Read current schema defaults
	var schemaCharset, schemaCollation string
	err := db.Raw("SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()").Row().Scan(&schemaCharset, &schemaCollation)
	if err != nil {
		return fmt.Errorf("读取当前库默认字符集/排序规则失败 / Failed to read schema default charset/collation: %v", err)
	}

	toLower := func(s string) string { return strings.ToLower(s) }
	// Allowed charsets that can store Chinese text
	allowedCharsets := map[string]string{
		"utf8mb4": "utf8mb4_",
		"utf8":    "utf8_",
		"gbk":     "gbk_",
		"big5":    "big5_",
		"gb18030": "gb18030_",
	}
	isChineseCapable := func(cs, cl string) bool {
		csLower := toLower(cs)
		clLower := toLower(cl)
		if prefix, ok := allowedCharsets[csLower]; ok {
			if clLower == "" {
				return true
			}
			return strings.HasPrefix(clLower, prefix)
		}
		// 如果仅提供了排序规则，尝试按排序规则前缀判断
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(clLower, prefix) {
				return true
			}
		}
		return false
	}

	// 1) 当前库默认值必须支持中文
	if !isChineseCapable(schemaCharset, schemaCollation) {
		return fmt.Errorf("当前库默认字符集/排序规则不支持中文：schema(%s/%s)。请将库设置为 utf8mb4/utf8/gbk/big5/gb18030 / Schema default charset/collation is not Chinese-capable: schema(%s/%s). Please set to utf8mb4/utf8/gbk/big5/gb18030",
			schemaCharset, schemaCollation, schemaCharset, schemaCollation)
	}

	// 2) 所有物理表的排序规则（隐含字符集）必须支持中文
	type tableInfo struct {
		Name      string
		Collation *string
	}
	var tables []tableInfo
	if err := db.Raw("SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'").Scan(&tables).Error; err != nil {
		return fmt.Errorf("读取表排序规则失败 / Failed to read table collations: %v", err)
	}

	var badTables []string
	for _, t := range tables {
		// NULL 或空表示继承库默认设置，已在上面校验库默认，视为通过
		if t.Collation == nil || *t.Collation == "" {
			continue
		}
		cl := *t.Collation
		// 仅凭排序规则判断是否中文可用
		ok := false
		lower := strings.ToLower(cl)
		for _, prefix := range allowedCharsets {
			if strings.HasPrefix(lower, prefix) {
				ok = true
				break
			}
		}
		if !ok {
			badTables = append(badTables, fmt.Sprintf("%s(%s)", t.Name, cl))
		}
	}

	if len(badTables) > 0 {
		// 限制输出数量以避免日志过长
		maxShow := 20
		shown := badTables
		if len(shown) > maxShow {
			shown = shown[:maxShow]
		}
		return fmt.Errorf(
			"存在不支持中文的表，请修复其排序规则/字符集。示例（最多展示 %d 项）：%v / Found tables not Chinese-capable. Please fix their collation/charset. Examples (showing up to %d): %v",
			maxShow, shown, maxShow, shown,
		)
	}
	return nil
}

var (
	lastPingTime time.Time
	pingMutex    sync.Mutex
)

func PingDB() error {
	pingMutex.Lock()
	defer pingMutex.Unlock()

	if time.Since(lastPingTime) < time.Second*10 {
		return nil
	}

	sqlDB, err := DB.DB()
	if err != nil {
		log.Printf("Error getting sql.DB from GORM: %v", err)
		return err
	}

	err = sqlDB.Ping()
	if err != nil {
		log.Printf("Error pinging DB: %v", err)
		return err
	}

	lastPingTime = time.Now()
	common.SysLog("Database pinged successfully")
	return nil
}
