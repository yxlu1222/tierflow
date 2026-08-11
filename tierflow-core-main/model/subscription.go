package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/pkg/cachex"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/samber/hot"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// Subscription duration units
const (
	SubscriptionDurationYear   = "year"
	SubscriptionDurationMonth  = "month"
	SubscriptionDurationDay    = "day"
	SubscriptionDurationHour   = "hour"
	SubscriptionDurationCustom = "custom"
)

// Subscription quota reset period
const (
	SubscriptionResetNever   = "never"
	SubscriptionResetDaily   = "daily"
	SubscriptionResetWeekly  = "weekly"
	SubscriptionResetMonthly = "monthly"
	SubscriptionResetCustom  = "custom"
)

var (
	ErrSubscriptionOrderNotFound      = errors.New("subscription order not found")
	ErrSubscriptionOrderStatusInvalid = errors.New("subscription order status invalid")

	// 预扣费哨兵错误 —— 上层(service/billing_session.go)用 errors.Is 判断,
	// 勿改文案语义;新增扣费失败类别时在此补充哨兵而不是返回裸 error。
	ErrNoActiveSubscription           = errors.New("no active subscription")
	ErrSubscriptionQuotaInsufficient  = errors.New("subscription quota insufficient")
	ErrSubscriptionPreConsumeRefunded = errors.New("subscription pre-consume already refunded")
	// ErrSubscriptionBucketExhausted:指定桶额度耗尽(P4 用于「高级额度用完 +
	// 超出基础模型上下文」等需要与普通额度不足区分的场景)。
	ErrSubscriptionBucketExhausted = errors.New("subscription bucket exhausted")
)

// SubscriptionBucket 标识套餐的两个独立额度桶。
// premium:高级模型桶,amount 量纲为 quota(录入 ¥ 按汇率换算);
// basic:基础模型桶,amount 量纲为 token 数。
type SubscriptionBucket string

const (
	BucketPremium SubscriptionBucket = "premium"
	BucketBasic   SubscriptionBucket = "basic"
)

// 基础桶总量取值语义(BasicTokenTotal):
//
//	-1 = 无限量;0 = 无基础桶;>0 = token 总量。
//
// 注意与高级桶(TotalAmount)的历史语义不同:那里 0 = 无限(遗留,新套餐不使用)。
const BasicTokenUnlimited = int64(-1)

// 订阅来源与订单类型
const (
	SubscriptionSourceUpgrade = "upgrade"
	// SubscriptionSourceRedemption:兑换码开通。注意它**会**计入
	// MaxPurchasePerUser —— CreateUserSubscriptionFromPlanTx 的上限统计只排除
	// upgrade(见 :541-544)，这符合礼品码语义。
	SubscriptionSourceRedemption = "redemption"

	SubscriptionOrderTypeNew     = "new"
	SubscriptionOrderTypeUpgrade = "upgrade"

	// SubscriptionOrderStatusManualReview:epay 升级订单已收款,但回调时源订阅
	// 已失效(付款窗口内被余额升级/过期),不自动发放,转人工处理(退款或补发)。
	// epay 无自动退款能力,自动发放会打开「一次差价两次升级」的套利窗口。
	SubscriptionOrderStatusManualReview = "manual_review"
)

// 升级折算的分母:套餐统一按 30 天计价(docs/subscription-gap-analysis.md §1)。
const subscriptionPeriodDays = 30

const (
	subscriptionPlanCacheNamespace     = "tierflow:subscription_plan:v1"
	subscriptionPlanInfoCacheNamespace = "tierflow:subscription_plan_info:v1"
)

var (
	subscriptionPlanCacheOnce     sync.Once
	subscriptionPlanInfoCacheOnce sync.Once

	subscriptionPlanCache     *cachex.HybridCache[SubscriptionPlan]
	subscriptionPlanInfoCache *cachex.HybridCache[SubscriptionPlanInfo]
)

func subscriptionPlanCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_TTL", 300)
	if ttlSeconds <= 0 {
		ttlSeconds = 300
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanInfoCacheTTL() time.Duration {
	ttlSeconds := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_TTL", 120)
	if ttlSeconds <= 0 {
		ttlSeconds = 120
	}
	return time.Duration(ttlSeconds) * time.Second
}

func subscriptionPlanCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_CACHE_CAP", 5000)
	if capacity <= 0 {
		capacity = 5000
	}
	return capacity
}

func subscriptionPlanInfoCacheCapacity() int {
	capacity := common.GetEnvOrDefault("SUBSCRIPTION_PLAN_INFO_CACHE_CAP", 10000)
	if capacity <= 0 {
		capacity = 10000
	}
	return capacity
}

func getSubscriptionPlanCache() *cachex.HybridCache[SubscriptionPlan] {
	subscriptionPlanCacheOnce.Do(func() {
		ttl := subscriptionPlanCacheTTL()
		subscriptionPlanCache = cachex.NewHybridCache[SubscriptionPlan](cachex.HybridCacheConfig[SubscriptionPlan]{
			Namespace: cachex.Namespace(subscriptionPlanCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlan]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlan] {
				return hot.NewHotCache[string, SubscriptionPlan](hot.LRU, subscriptionPlanCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanCache
}

func getSubscriptionPlanInfoCache() *cachex.HybridCache[SubscriptionPlanInfo] {
	subscriptionPlanInfoCacheOnce.Do(func() {
		ttl := subscriptionPlanInfoCacheTTL()
		subscriptionPlanInfoCache = cachex.NewHybridCache[SubscriptionPlanInfo](cachex.HybridCacheConfig[SubscriptionPlanInfo]{
			Namespace: cachex.Namespace(subscriptionPlanInfoCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[SubscriptionPlanInfo]{},
			Memory: func() *hot.HotCache[string, SubscriptionPlanInfo] {
				return hot.NewHotCache[string, SubscriptionPlanInfo](hot.LRU, subscriptionPlanInfoCacheCapacity()).
					WithTTL(ttl).
					WithJanitor().
					Build()
			},
		})
	})
	return subscriptionPlanInfoCache
}

func subscriptionPlanCacheKey(id int) string {
	if id <= 0 {
		return ""
	}
	return strconv.Itoa(id)
}

func InvalidateSubscriptionPlanCache(planId int) {
	if planId <= 0 {
		return
	}
	cache := getSubscriptionPlanCache()
	_, _ = cache.DeleteMany([]string{subscriptionPlanCacheKey(planId)})
	infoCache := getSubscriptionPlanInfoCache()
	_ = infoCache.Purge()
}

// Subscription plan
type SubscriptionPlan struct {
	Id int `json:"id"`

	Title    string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle string `json:"subtitle" gorm:"type:varchar(255);default:''"`

	// 售价(人民币,全站唯一货币;follow existing code style: float64 for money)
	PriceAmount float64 `json:"price_amount" gorm:"type:decimal(10,6);not null;default:0"`

	DurationUnit  string `json:"duration_unit" gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue int    `json:"duration_value" gorm:"type:int;not null;default:1"`
	CustomSeconds int64  `json:"custom_seconds" gorm:"type:bigint;not null;default:0"`

	Enabled   bool `json:"enabled" gorm:"default:true"`
	SortOrder int  `json:"sort_order" gorm:"type:int;default:0"`

	// 推荐标记:套餐页/充值页高亮展示该档(蓝色描边 + 「推荐」徽章)
	Recommended bool `json:"recommended" gorm:"default:false"`

	AllowBalancePay *bool `json:"allow_balance_pay" gorm:"default:true"`

	// Max purchases per user (0 = unlimited)
	MaxPurchasePerUser int `json:"max_purchase_per_user" gorm:"type:int;default:0"`

	// Upgrade user group after purchase (empty = no change)
	UpgradeGroup string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`

	// 高级模型桶总量(quota 单位,管理端录入 ¥ 换算;历史语义 0 = 无限保留,新套餐不使用)
	TotalAmount int64 `json:"total_amount" gorm:"type:bigint;not null;default:0"`

	// 基础模型桶总量(token 数):-1 = 无限,0 = 无基础桶,>0 = token 总量
	BasicTokenTotal int64 `json:"basic_token_total" gorm:"type:bigint;not null;default:0"`

	// 两个桶各自的套餐模型组(PlanModelSet)引用,0 = 未配置。
	// 桶判定见 ResolveModelBucket:basic set 命中→basic,否则一律 premium。
	PremiumSetId int `json:"premium_set_id" gorm:"type:int;not null;default:0"`
	BasicSetId   int `json:"basic_set_id" gorm:"type:int;not null;default:0"`

	// Quota reset period for plan
	QuotaResetPeriod        string `json:"quota_reset_period" gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64  `json:"quota_reset_custom_seconds" gorm:"type:bigint;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (p *SubscriptionPlan) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	p.CreatedAt = now
	p.UpdatedAt = now
	return nil
}

func (p *SubscriptionPlan) BeforeUpdate(tx *gorm.DB) error {
	p.UpdatedAt = common.GetTimestamp()
	return nil
}

func (p *SubscriptionPlan) NormalizeDefaults() {
	if p.AllowBalancePay == nil {
		p.AllowBalancePay = common.GetPointer(true)
	}
}

// Subscription order (payment -> webhook -> create UserSubscription)
type SubscriptionOrder struct {
	Id     int     `json:"id"`
	UserId int     `json:"user_id" gorm:"index"`
	PlanId int     `json:"plan_id" gorm:"index"`
	Money  float64 `json:"money"`

	TradeNo         string `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	Status          string `json:"status"`
	// OrderType 区分新购与升级;UserSubscriptionId 关联订单产出的订阅实例,
	// 升级订单据此追溯目标订阅(此前只有 plan_id,无法追溯)。
	OrderType          string `json:"order_type" gorm:"type:varchar(16);default:'new'"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index;default:0"`
	// FromSubscriptionId 升级订单的源订阅 id(epay 升级回调据此定位要作废的旧订阅;
	// 余额升级同步写入,口径一致)。新购订单为 0。
	FromSubscriptionId int   `json:"from_subscription_id" gorm:"index;default:0"`
	CreateTime         int64 `json:"create_time"`
	CompleteTime       int64 `json:"complete_time"`

	ProviderPayload string `json:"provider_payload" gorm:"type:text"`
}

func (o *SubscriptionOrder) Insert() error {
	if o.CreateTime == 0 {
		o.CreateTime = common.GetTimestamp()
	}
	return DB.Create(o).Error
}

func (o *SubscriptionOrder) Update() error {
	return DB.Save(o).Error
}

func GetSubscriptionOrderByTradeNo(tradeNo string) *SubscriptionOrder {
	if tradeNo == "" {
		return nil
	}
	var order SubscriptionOrder
	if err := DB.Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
		return nil
	}
	return &order
}

// User subscription instance
type UserSubscription struct {
	Id     int `json:"id"`
	UserId int `json:"user_id,omitempty" gorm:"index;index:idx_user_sub_active,priority:1"`
	PlanId int `json:"plan_id" gorm:"index"`

	// 高级模型桶(quota 单位;历史语义 0 = 无限保留)
	AmountTotal int64 `json:"amount_total" gorm:"type:bigint;not null;default:0"`
	AmountUsed  int64 `json:"amount_used" gorm:"type:bigint;not null;default:0"`

	// 基础模型桶(token 数;-1 = 无限,0 = 无基础桶)
	BasicTokenTotal int64 `json:"basic_token_total" gorm:"type:bigint;not null;default:0"`
	BasicTokenUsed  int64 `json:"basic_token_used" gorm:"type:bigint;not null;default:0"`

	// 购买时的套餐售价快照(¥)。升级折算的分子,plan 改价不影响已购订阅。
	// ⚠️ 不要给本表(AutoMigrate 管理)的字段用 decimal(10,6) 这类带逗号的类型:
	// glebarez/sqlite 的 AlterColumn 用非贪婪正则改写 DDL,会在类型内的逗号处截断,
	// 触发 "invalid DDL, unbalanced brackets" 启动失败(subscription_plans 手写 DDL
	// 正是为绕开此坑)。裸 float64 与 SubscriptionOrder.Money 同风格。
	PaidMoney float64 `json:"paid_money" gorm:"not null;default:0"`

	StartTime int64  `json:"start_time" gorm:"bigint"`
	EndTime   int64  `json:"end_time" gorm:"bigint;index;index:idx_user_sub_active,priority:3"`
	Status    string `json:"status" gorm:"type:varchar(32);index;index:idx_user_sub_active,priority:2"` // active/expired/cancelled

	Source string `json:"source" gorm:"type:varchar(32);default:'order'"` // order/admin

	LastResetTime int64 `json:"last_reset_time" gorm:"type:bigint;default:0"`
	NextResetTime int64 `json:"next_reset_time" gorm:"type:bigint;default:0;index"`

	UpgradeGroup  string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`
	PrevUserGroup string `json:"prev_user_group" gorm:"type:varchar(64);default:''"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`

	// IssuedTokenKey 是创建订阅时自动签发的套餐专用 Key(裸串,不含 sk- 前缀)。
	// 仅在创建当次返回给调用方展示,不落库。
	IssuedTokenKey string `json:"issued_token_key,omitempty" gorm:"-"`

	// PlanTitle 是套餐名,由 buildSubscriptionSummaries 按 plan_id 直查回填,不落库。
	//
	// 必须由后端下发:展示层曾靠客户端 join 在售套餐列表(/subscription/plans)取名,
	// 而该端点只返回 enabled 的套餐。「停用套餐」的语义仅是停止售卖新订阅,但那样
	// 一来存量未过期订阅就会 join 不到、丢掉套餐名(退化成「当前订阅」/「订阅 #id」)。
	// 此处按 plan_id 直查,不受 enabled 影响;套餐被硬删时为空串,展示层保留兜底。
	PlanTitle string `json:"plan_title,omitempty" gorm:"-"`
}

func (s *UserSubscription) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	return nil
}

func (s *UserSubscription) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

type SubscriptionSummary struct {
	Subscription *UserSubscription `json:"subscription"`
}

func calcPlanEndTime(start time.Time, plan *SubscriptionPlan) (int64, error) {
	if plan == nil {
		return 0, errors.New("plan is nil")
	}
	if plan.DurationValue <= 0 && plan.DurationUnit != SubscriptionDurationCustom {
		return 0, errors.New("duration_value must be > 0")
	}
	switch plan.DurationUnit {
	case SubscriptionDurationYear:
		return start.AddDate(plan.DurationValue, 0, 0).Unix(), nil
	case SubscriptionDurationMonth:
		return start.AddDate(0, plan.DurationValue, 0).Unix(), nil
	case SubscriptionDurationDay:
		return start.Add(time.Duration(plan.DurationValue) * 24 * time.Hour).Unix(), nil
	case SubscriptionDurationHour:
		return start.Add(time.Duration(plan.DurationValue) * time.Hour).Unix(), nil
	case SubscriptionDurationCustom:
		if plan.CustomSeconds <= 0 {
			return 0, errors.New("custom_seconds must be > 0")
		}
		return start.Add(time.Duration(plan.CustomSeconds) * time.Second).Unix(), nil
	default:
		return 0, fmt.Errorf("invalid duration_unit: %s", plan.DurationUnit)
	}
}

func NormalizeResetPeriod(period string) string {
	switch strings.TrimSpace(period) {
	case SubscriptionResetDaily, SubscriptionResetWeekly, SubscriptionResetMonthly, SubscriptionResetCustom:
		return strings.TrimSpace(period)
	default:
		return SubscriptionResetNever
	}
}

func calcNextResetTime(base time.Time, plan *SubscriptionPlan, endUnix int64) int64 {
	if plan == nil {
		return 0
	}
	period := NormalizeResetPeriod(plan.QuotaResetPeriod)
	if period == SubscriptionResetNever {
		return 0
	}
	var next time.Time
	switch period {
	case SubscriptionResetDaily:
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, 1)
	case SubscriptionResetWeekly:
		// Align to next Monday 00:00
		weekday := int(base.Weekday()) // Sunday=0
		// Convert to Monday=1..Sunday=7
		if weekday == 0 {
			weekday = 7
		}
		daysUntil := 8 - weekday
		next = time.Date(base.Year(), base.Month(), base.Day(), 0, 0, 0, 0, base.Location()).
			AddDate(0, 0, daysUntil)
	case SubscriptionResetMonthly:
		// Align to first day of next month 00:00
		next = time.Date(base.Year(), base.Month(), 1, 0, 0, 0, 0, base.Location()).
			AddDate(0, 1, 0)
	case SubscriptionResetCustom:
		if plan.QuotaResetCustomSeconds <= 0 {
			return 0
		}
		next = base.Add(time.Duration(plan.QuotaResetCustomSeconds) * time.Second)
	default:
		return 0
	}
	if endUnix > 0 && next.Unix() > endUnix {
		return 0
	}
	return next.Unix()
}

func GetSubscriptionPlanById(id int) (*SubscriptionPlan, error) {
	return getSubscriptionPlanByIdTx(nil, id)
}

func getSubscriptionPlanByIdTx(tx *gorm.DB, id int) (*SubscriptionPlan, error) {
	if id <= 0 {
		return nil, errors.New("invalid plan id")
	}
	key := subscriptionPlanCacheKey(id)
	if key != "" {
		if cached, found, err := getSubscriptionPlanCache().Get(key); err == nil && found {
			cached.NormalizeDefaults()
			return &cached, nil
		}
	}
	var plan SubscriptionPlan
	query := DB
	if tx != nil {
		query = tx
	}
	if err := query.Where("id = ?", id).First(&plan).Error; err != nil {
		return nil, err
	}
	plan.NormalizeDefaults()
	_ = getSubscriptionPlanCache().SetWithTTL(key, plan, subscriptionPlanCacheTTL())
	return &plan, nil
}

func CountUserSubscriptionsByPlan(userId int, planId int) (int64, error) {
	if userId <= 0 || planId <= 0 {
		return 0, errors.New("invalid userId or planId")
	}
	var count int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND plan_id = ?", userId, planId).
		Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func getUserGroupByIdTx(tx *gorm.DB, userId int) (string, error) {
	if userId <= 0 {
		return "", errors.New("invalid userId")
	}
	if tx == nil {
		tx = DB
	}
	var group string
	if err := tx.Model(&User{}).Where("id = ?", userId).Select(commonGroupCol).Find(&group).Error; err != nil {
		return "", err
	}
	return group, nil
}

func downgradeUserGroupForSubscriptionTx(tx *gorm.DB, sub *UserSubscription, now int64) (string, error) {
	if tx == nil || sub == nil {
		return "", errors.New("invalid downgrade args")
	}
	upgradeGroup := strings.TrimSpace(sub.UpgradeGroup)
	if upgradeGroup == "" {
		return "", nil
	}
	currentGroup, err := getUserGroupByIdTx(tx, sub.UserId)
	if err != nil {
		return "", err
	}
	if currentGroup != upgradeGroup {
		return "", nil
	}
	var activeSub UserSubscription
	activeQuery := tx.Where("user_id = ? AND status = ? AND end_time > ? AND id <> ? AND upgrade_group <> ''",
		sub.UserId, "active", now, sub.Id).
		Order("end_time desc, id desc").
		Limit(1).
		Find(&activeSub)
	if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
		return "", nil
	}
	prevGroup := strings.TrimSpace(sub.PrevUserGroup)
	if prevGroup == "" || prevGroup == currentGroup {
		return "", nil
	}
	if err := tx.Model(&User{}).Where("id = ?", sub.UserId).
		Update("group", prevGroup).Error; err != nil {
		return "", err
	}
	return prevGroup, nil
}

func CreateUserSubscriptionFromPlanTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, source string) (*UserSubscription, error) {
	if tx == nil {
		return nil, errors.New("tx is nil")
	}
	if plan == nil || plan.Id == 0 {
		return nil, errors.New("invalid plan")
	}
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	// 升级产生的订阅不受、也不占用购买次数上限(D10:升级是套餐间迁移,非新购)
	if plan.MaxPurchasePerUser > 0 && source != SubscriptionSourceUpgrade {
		var count int64
		if err := tx.Model(&UserSubscription{}).
			Where("user_id = ? AND plan_id = ? AND source <> ?", userId, plan.Id, SubscriptionSourceUpgrade).
			Count(&count).Error; err != nil {
			return nil, err
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			// sentinel:epay 回调交付时命中上限(两张 pending 单先后付款等竞态)
			// 属「钱已收但不能交付」,调用方须据此转 manual_review 而非报错重试
			return nil, ErrSubscriptionPurchaseLimitReached
		}
	}
	nowUnix := GetDBTimestampTx(tx)
	now := time.Unix(nowUnix, 0)
	endUnix, err := calcPlanEndTime(now, plan)
	if err != nil {
		return nil, err
	}
	resetBase := now
	nextReset := calcNextResetTime(resetBase, plan, endUnix)
	lastReset := int64(0)
	if nextReset > 0 {
		lastReset = now.Unix()
	}
	upgradeGroup := strings.TrimSpace(plan.UpgradeGroup)
	prevGroup := ""
	if upgradeGroup != "" {
		currentGroup, err := getUserGroupByIdTx(tx, userId)
		if err != nil {
			return nil, err
		}
		if currentGroup != upgradeGroup {
			prevGroup = currentGroup
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("group", upgradeGroup).Error; err != nil {
				return nil, err
			}
		}
	}
	sub := &UserSubscription{
		UserId:          userId,
		PlanId:          plan.Id,
		AmountTotal:     plan.TotalAmount,
		AmountUsed:      0,
		BasicTokenTotal: plan.BasicTokenTotal,
		BasicTokenUsed:  0,
		PaidMoney:       plan.PriceAmount,
		StartTime:       now.Unix(),
		EndTime:         endUnix,
		Status:          "active",
		Source:          source,
		LastResetTime:   lastReset,
		NextResetTime:   nextReset,
		UpgradeGroup:    upgradeGroup,
		PrevUserGroup:   prevGroup,
		CreatedAt:       common.GetTimestamp(),
		UpdatedAt:       common.GetTimestamp(),
	}
	if err := tx.Create(sub).Error; err != nil {
		return nil, err
	}
	// 自动签发套餐专用 Key(D9:Key 决定资金源)。四条订阅创建路径都经过本函数,
	// 故只在此处挂钩。失败则整体回滚——没有 Key 的订阅无法使用。
	key, err := issueSubscriptionTokenTx(tx, userId, sub, plan.Title)
	if err != nil {
		return nil, err
	}
	sub.IssuedTokenKey = key
	return sub, nil
}

// issueSubscriptionTokenTx 为订阅签发专用 Key(照 controller/user.go 注册发 Key 模板):
// UnlimitedQuota=true(真实账本在订阅双桶,token 额度不作闸门)、过期时间对齐订阅。
func issueSubscriptionTokenTx(tx *gorm.DB, userId int, sub *UserSubscription, planTitle string) (string, error) {
	key, err := common.GenerateKey()
	if err != nil {
		return "", err
	}
	name := fmt.Sprintf("套餐-%s", planTitle)
	if len([]rune(name)) > 30 {
		name = string([]rune(name)[:30])
	}
	name = fmt.Sprintf("%s-%d", name, sub.Id)
	token := &Token{
		UserId:             userId,
		Name:               name,
		Key:                key,
		CreatedTime:        common.GetTimestamp(),
		AccessedTime:       common.GetTimestamp(),
		ExpiredTime:        sub.EndTime,
		UnlimitedQuota:     true,
		Status:             common.TokenStatusEnabled,
		UserSubscriptionId: sub.Id,
	}
	if err := tx.Create(token).Error; err != nil {
		return "", err
	}
	return key, nil
}

// GetUserSubscriptionOwned 按 id 取订阅,并校验归属(用户侧接口的统一入口)。
func GetUserSubscriptionOwned(userId int, userSubscriptionId int) (*UserSubscription, error) {
	if userId <= 0 || userSubscriptionId <= 0 {
		return nil, errors.New("invalid subscription id")
	}
	var sub UserSubscription
	if err := DB.Where("id = ? AND user_id = ?", userSubscriptionId, userId).First(&sub).Error; err != nil {
		return nil, err
	}
	return &sub, nil
}

// GetSubscriptionToken 取某条订阅当前的专用 Key。一条订阅只留一把有效 Key
// (轮换会删旧建新),多条时取最新的一条兜底。
func GetSubscriptionToken(userId int, userSubscriptionId int) (*Token, error) {
	if _, err := GetUserSubscriptionOwned(userId, userSubscriptionId); err != nil {
		return nil, err
	}
	var token Token
	err := DB.Where("user_id = ? AND user_subscription_id = ?", userId, userSubscriptionId).
		Order("id desc").First(&token).Error
	if err != nil {
		return nil, err
	}
	return &token, nil
}

// RotateSubscriptionToken 轮换订阅专用 Key:事务内删掉旧 Key、按同一模板签发新的。
// 旧 Key 立即失效(含 Redis 缓存),正在使用它的调用方会直接鉴权失败——这是
// 「手动更新 Key」的既定语义,前端必须先做二次确认。
func RotateSubscriptionToken(userId int, userSubscriptionId int) (string, error) {
	sub, err := GetUserSubscriptionOwned(userId, userSubscriptionId)
	if err != nil {
		return "", err
	}
	if sub.Status != "active" || (sub.EndTime > 0 && sub.EndTime <= common.GetTimestamp()) {
		return "", errors.New("订阅未生效,无法更新 Key")
	}
	planTitle := ""
	if plan, err := GetSubscriptionPlanById(sub.PlanId); err == nil && plan != nil {
		planTitle = plan.Title
	}

	var staleKeys []string
	var newKey string
	err = DB.Transaction(func(tx *gorm.DB) error {
		var olds []Token
		if err := tx.Where("user_id = ? AND user_subscription_id = ?", userId, sub.Id).Find(&olds).Error; err != nil {
			return err
		}
		for _, old := range olds {
			staleKeys = append(staleKeys, old.Key)
		}
		if len(olds) > 0 {
			if err := tx.Where("user_id = ? AND user_subscription_id = ?", userId, sub.Id).
				Delete(&Token{}).Error; err != nil {
				return err
			}
		}
		key, err := issueSubscriptionTokenTx(tx, userId, sub, planTitle)
		if err != nil {
			return err
		}
		newKey = key
		return nil
	})
	if err != nil {
		return "", err
	}
	// 事务提交后再清缓存:提前清会让回滚后的旧 Key 反而要等缓存自然过期。
	// 必须先判 RedisEnabled —— cacheDeleteToken 会直接解引用 RDB,未启用 Redis
	// 时是 nil 指针 panic(其余调用点都由 shouldUpdateRedis 挡着)。
	for _, key := range staleKeys {
		if key == "" || !common.RedisEnabled {
			continue
		}
		if err := cacheDeleteToken(key); err != nil {
			common.SysLog("failed to delete rotated subscription token cache: " + err.Error())
		}
	}
	return newKey, nil
}

// SubscriptionOrderOutcome 描述一次回调实际发生了什么,供调用方决定
// 面向用户的表现(浏览器回跳页):delivered/already_done → 成功页,
// manual_review → 处理中页,绝不能把转人工渲染成「支付成功」。
type SubscriptionOrderOutcome string

const (
	SubscriptionOrderOutcomeDelivered    SubscriptionOrderOutcome = "delivered"
	SubscriptionOrderOutcomeAlreadyDone  SubscriptionOrderOutcome = "already_done"
	SubscriptionOrderOutcomeManualReview SubscriptionOrderOutcome = "manual_review"
)

// 升级差价单的有效窗口。差价按下单时点的剩余天数折算,若允许无限期挂单晚付,
// 用户可先锁低价、把旧套餐用到临期再付款,套走已消耗天数的折算价值。
// 超窗后的付款照收(网关无法拒收)但不自动交付,转人工按当时报价处理。
const subscriptionUpgradeOrderTTLSeconds int64 = 30 * 60

// Complete a subscription order (idempotent). Creates a UserSubscription snapshot from the plan.
// expectedPaymentProvider guards against cross-gateway callback attacks (empty skips the check).
// actualPaymentMethod updates the order's PaymentMethod to reflect the real payment type used (empty skips update).
//
// 错误语义约定:返回 error 仅代表「本次处理失败、网关应重试」(瞬时 DB 错误、
// 订单不存在等);凡是「钱已收但不能自动交付」的终态一律落 manual_review 并
// 返回 nil——回调必须被吞掉,否则网关无限重试,而这笔钱在系统里毫无痕迹。
func CompleteSubscriptionOrder(tradeNo string, providerPayload string, expectedPaymentProvider string, actualPaymentMethod string) (SubscriptionOrderOutcome, error) {
	if tradeNo == "" {
		return "", errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	var logUserId int
	var logPlanTitle string
	var logMoney float64
	var logPaymentMethod string
	var upgradeGroup string
	var isUpgrade bool
	var manualReviewReason string
	outcome := SubscriptionOrderOutcomeDelivered
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status == common.TopUpStatusSuccess {
			outcome = SubscriptionOrderOutcomeAlreadyDone
			return nil
		}
		// 已转人工的订单同样直接吞掉回调,否则网关会无限重试
		if order.Status == SubscriptionOrderStatusManualReview {
			outcome = SubscriptionOrderOutcomeManualReview
			return nil
		}
		isUpgrade = order.OrderType == SubscriptionOrderTypeUpgrade

		// 统一的「收款成立但不能自动交付」出口:标记 manual_review、写 TopUp
		// (真实收款必须进财务对账表,人工补偿时才有凭证可对;状态用 pending
		// 而非 success——账单页渲染 TopUp.status,转人工绝不能显示成「成功」)、
		// 保存订单。刻意不依赖 plan:套餐可能已被删除,此出口必须始终可达。
		toManualReview := func(reason string) error {
			manualReviewReason = reason
			outcome = SubscriptionOrderOutcomeManualReview
			order.Status = SubscriptionOrderStatusManualReview
			order.CompleteTime = common.GetTimestamp()
			if providerPayload != "" {
				order.ProviderPayload = providerPayload
			}
			if actualPaymentMethod != "" && order.PaymentMethod != actualPaymentMethod {
				order.PaymentMethod = actualPaymentMethod
			}
			if err := upsertSubscriptionTopUpTx(tx, &order, common.TopUpStatusPending, false); err != nil {
				return err
			}
			logUserId = order.UserId
			logMoney = order.Money
			logPaymentMethod = order.PaymentMethod
			return tx.Save(&order).Error
		}

		// 已作废(expired)的订单收到经签名验证的付款回调:钱已被网关扣走,
		// 但订单已被新单/余额升级作废——不交付(避免一次差价两次升级),
		// 也绝不能返回错误(那会让这笔真实收款在系统里消失)。
		// 本分支必须先于 plan 查询:作废单不阻止删套餐,plan 可能已不存在。
		if order.Status == common.TopUpStatusExpired {
			return toManualReview("订单已作废后收到付款")
		}
		if order.Status != common.TopUpStatusPending {
			return ErrSubscriptionOrderStatusInvalid
		}

		// 必须用 tx 版本:事务内经 DB 池另开连接读 plan,单连接池(SQLite/测试)
		// 会与本事务持有的连接互等死锁,生产上也破坏事务读一致性。
		// 套餐已被硬删 → 钱已收但无法交付,转人工;其它错误让网关重试。
		plan, err := getSubscriptionPlanByIdTx(tx, order.PlanId)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return toManualReview("目标套餐已被删除")
			}
			return err
		}
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		logPlanTitle = plan.Title

		if isUpgrade {
			// epay 升级回调:锁源订阅,仍生效才执行升级(作废旧订阅→禁旧 Key→
			// 建新订阅)。不能自动交付的情形(源订阅失效/报价过期)转人工——
			// epay 无自动退款,自动发放有套利窗口。
			now := GetDBTimestampTx(tx)
			// 差价报价按下单时点折算,超窗晚付会套走已消耗天数的价值。
			// CreateTime 与 now 均取 DB 时钟(下单侧见 CreateSubscriptionUpgradeEpayOrder),
			// 混用各节点 app 时钟会因漂移误判超窗/放行。
			if now-order.CreateTime > subscriptionUpgradeOrderTTLSeconds {
				return toManualReview("升级订单超过有效窗口后才完成支付,报价已过期")
			}
			var sub UserSubscription
			subErr := lockForUpdate(tx).
				Where("id = ? AND user_id = ?", order.FromSubscriptionId, order.UserId).
				First(&sub).Error
			if subErr != nil && !errors.Is(subErr, gorm.ErrRecordNotFound) {
				// 锁等待超时等瞬时 DB 错误 ≠ 源订阅失效:返回错误让网关重试,
				// 误转人工会把健康订单永久钉死在人工通道
				return subErr
			}
			if subErr != nil || sub.Status != "active" || sub.EndTime <= now {
				return toManualReview("源订阅已失效(付款窗口内被余额升级或已过期)")
			}
			newSub, err := performUpgradeTx(tx, now, order.UserId, &sub, plan)
			if err != nil {
				return err
			}
			order.UserSubscriptionId = newSub.Id
		} else {
			// 新购回调复检购买守卫(与余额购买路径对称):下单后、付款前用户
			// 可能已购入更高档套餐,此时交付会造出规则禁止的低/平级并存。
			// 守卫拒绝 ≠ 拒收钱——转人工退款或按用户意愿处理。
			if guardErr := checkActivePurchaseAllowedTx(tx, order.UserId, plan, GetDBTimestampTx(tx)); guardErr != nil {
				if errors.Is(guardErr, ErrSubscriptionNotUpgradable) || errors.Is(guardErr, ErrSubscriptionUpgradeOnly) {
					return toManualReview("付款完成时用户已持有同级或更高的生效套餐")
				}
				return guardErr
			}
			newSub, err := CreateUserSubscriptionFromPlanTx(tx, order.UserId, plan, "order")
			if err != nil {
				// 交付时命中购买上限(两张 pending 单先后付款等竞态):
				// 永久性业务错误,重试永远失败,必须转人工而非让网关打转
				if errors.Is(err, ErrSubscriptionPurchaseLimitReached) {
					return toManualReview("付款完成时已达到该套餐购买上限")
				}
				return err
			}
			order.UserSubscriptionId = newSub.Id
		}
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if providerPayload != "" {
			order.ProviderPayload = providerPayload
		}
		// ⚠️ 实际支付方式必须在 upsert **之前**改写(与 toManualReview 同序)。
		// 反过来的话镜像行会拿到下单时申请的方式、订单随后被改成网关回报的方式,
		// 两行永久不一致;之后任何再次 upsert(如管理员标记退款)都会撞上
		// ErrPaymentMethodMismatch 守卫并回滚整个事务,该订单再也无法退款。
		if actualPaymentMethod != "" && order.PaymentMethod != actualPaymentMethod {
			order.PaymentMethod = actualPaymentMethod
		}
		if err := upsertSubscriptionTopUpTx(tx, &order, common.TopUpStatusSuccess, false); err != nil {
			return err
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logPlanTitle = plan.Title
		logMoney = order.Money
		logPaymentMethod = order.PaymentMethod
		return nil
	})
	if err != nil {
		return "", err
	}
	if manualReviewReason != "" {
		msg := fmt.Sprintf("订阅订单已收款但未自动交付,转人工处理。原因: %s。订单号: %s，套餐: %s，支付金额: %.2f", manualReviewReason, tradeNo, logPlanTitle, logMoney)
		common.SysLog("subscription order needs manual review: " + msg)
		if logUserId > 0 {
			RecordLog(logUserId, LogTypeTopup, msg)
		}
		return outcome, nil
	}
	if outcome != SubscriptionOrderOutcomeDelivered {
		// 幂等重放(already_done / 既有 manual_review):无副作用,直接返回
		return outcome, nil
	}
	if isUpgrade && logUserId > 0 {
		// 升级禁用了旧订阅的 Key,必须失效 Token 缓存
		_ = InvalidateUserTokensCache(logUserId)
	}
	if upgradeGroup != "" && logUserId > 0 {
		_ = UpdateUserGroupCache(logUserId, upgradeGroup)
	}
	if logUserId > 0 {
		var msg string
		if isUpgrade {
			msg = fmt.Sprintf("套餐升级成功（在线支付差价），套餐: %s，支付金额: %.2f，支付方式: %s", logPlanTitle, logMoney, logPaymentMethod)
		} else {
			msg = fmt.Sprintf("订阅购买成功，套餐: %s，支付金额: %.2f，支付方式: %s", logPlanTitle, logMoney, logPaymentMethod)
		}
		RecordLog(logUserId, LogTypeTopup, msg)
	}
	return outcome, nil
}

// upsertSubscriptionTopUpTx 把订阅订单同步进账单表(TopUp)。
// status 由调用方决定:正常交付 success;manual_review 用 pending——
// 账单页直接渲染 TopUp.status,转人工的收款绝不能显示成「成功」。
//
// allowMethodRebind:是否允许用订单的支付方式覆盖镜像行上不一致的旧值。
// 支付方式不一致守卫(ErrPaymentMethodMismatch)防的是跨网关回调攻击,回调路径
// 必须传 false 保留它;但**管理员显式操作**(退款/关单)不该被历史遗留的不一致
// 数据钉死 —— 早期成功分支的赋值顺序有误,已产生两行永久不一致的存量订单,
// 那些订单在 rebind=false 下会永远无法退款(整事务回滚)。故仅这类路径传 true。
func upsertSubscriptionTopUpTx(tx *gorm.DB, order *SubscriptionOrder, status string, allowMethodRebind bool) error {
	if tx == nil || order == nil {
		return errors.New("invalid subscription order")
	}
	now := common.GetTimestamp()
	var topup TopUp
	if err := tx.Where("trade_no = ?", order.TradeNo).First(&topup).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			topup = TopUp{
				UserId:        order.UserId,
				Amount:        0,
				Money:         order.Money,
				TradeNo:       order.TradeNo,
				PaymentMethod: order.PaymentMethod,
				CreateTime:    order.CreateTime,
				CompleteTime:  now,
				Status:        status,
			}
			return tx.Create(&topup).Error
		}
		return err
	}
	topup.Money = order.Money
	if topup.PaymentMethod == "" || allowMethodRebind {
		topup.PaymentMethod = order.PaymentMethod
	} else if topup.PaymentMethod != order.PaymentMethod {
		return ErrPaymentMethodMismatch
	}
	if topup.CreateTime == 0 {
		topup.CreateTime = order.CreateTime
	}
	topup.CompleteTime = now
	topup.Status = status
	return tx.Save(&topup).Error
}

func ExpireSubscriptionOrder(tradeNo string, expectedPaymentProvider string) error {
	if tradeNo == "" {
		return errors.New("tradeNo is empty")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if expectedPaymentProvider != "" && order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status != common.TopUpStatusPending {
			return nil
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Save(&order).Error
	})
}

// Admin bind (no payment). Creates a UserSubscription from a plan.
func AdminBindSubscription(userId int, planId int, sourceNote string) (string, error) {
	if userId <= 0 || planId <= 0 {
		return "", errors.New("invalid userId or planId")
	}
	plan, err := GetSubscriptionPlanById(planId)
	if err != nil {
		return "", err
	}
	err = DB.Transaction(func(tx *gorm.DB) error {
		_, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, "admin")
		return err
	})
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(plan.UpgradeGroup) != "" {
		_ = UpdateUserGroupCache(userId, plan.UpgradeGroup)
		return fmt.Sprintf("用户分组将升级到 %s", plan.UpgradeGroup), nil
	}
	return "", nil
}

// calcSubscriptionBalanceQuota 把套餐售价(人民币)换算成内部 quota。
// quota 内部锚定美元(QuotaPerUnit = 每美元 quota 数),故须先经汇率折美元:
//
//	quota = price(¥) ÷ USDExchangeRate × QuotaPerUnit
//
// 若不除汇率,¥9.9 会按 $9.9(≈¥72)扣,严重多扣。
func calcSubscriptionBalanceQuota(priceAmount float64) (int, error) {
	if priceAmount <= 0 {
		return 0, nil
	}
	if common.QuotaPerUnit <= 0 {
		return 0, errors.New("额度单位配置错误")
	}
	rate := operation_setting.USDExchangeRate
	if rate <= 0 {
		return 0, errors.New("汇率配置错误")
	}
	quota := decimal.NewFromFloat(priceAmount).
		Div(decimal.NewFromFloat(rate)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
		Ceil().
		IntPart()
	return int(quota), nil
}

// ErrSubscriptionPurchaseBlocked:有生效订阅时的新购拦截(展示层可据此置灰)。
var (
	ErrSubscriptionNotUpgradable = errors.New("已有生效套餐,仅支持升级到更高价格的套餐")
	ErrSubscriptionUpgradeOnly   = errors.New("已有生效套餐,更高档套餐请通过升级补差价开通")
	// ErrSubscriptionPurchaseLimitReached:交付时命中套餐购买上限。
	// 必须是 sentinel:epay 回调据此区分「转人工」与「瞬时错误重试」。
	ErrSubscriptionPurchaseLimitReached = errors.New("已达到该套餐购买上限")
)

// checkActivePurchaseAllowedTx 有生效订阅时的新购守卫(已确认的产品规则):
//   - 无生效订阅 → 放行
//   - 目标套餐 = 任一生效订阅的套餐 → 放行(同套餐叠加续费,受购买上限约束)
//   - 价格 > 生效订阅最高快照价(anchor)→ 拒绝,引导走升级补差价
//   - 其余(≤ anchor 的其它套餐)→ 拒绝(不可降级/平级换购)
//
// 前端置灰只是 UX,这里才是权威拦截(直接调 API 也拦得住)。
//
// 并发安全:先锁用户行再读生效订阅。订阅表的普通 SELECT 看不见并发事务
// 未提交的新 active 行(写偏斜),两笔并发购买会双双放行、造出规则禁止的
// 低高档并存;以用户行为购买互斥锁后,同一用户的交付事务串行化。
func checkActivePurchaseAllowedTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, now int64) error {
	var lockUser User
	if err := lockForUpdate(tx).Select("id").
		Where("id = ?", userId).First(&lockUser).Error; err != nil {
		return err
	}
	var actives []UserSubscription
	if err := tx.Select("id", "plan_id", "paid_money").
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Find(&actives).Error; err != nil {
		return err
	}
	if len(actives) == 0 {
		return nil
	}
	maxPaid := 0.0
	for _, s := range actives {
		if s.PlanId == plan.Id {
			return nil
		}
		if s.PaidMoney > maxPaid {
			maxPaid = s.PaidMoney
		}
	}
	if plan.PriceAmount > maxPaid {
		return ErrSubscriptionUpgradeOnly
	}
	return ErrSubscriptionNotUpgradable
}

// CheckActivePurchaseAllowed 免事务版本,供 epay 下单前的预检。
func CheckActivePurchaseAllowed(userId int, plan *SubscriptionPlan) error {
	return checkActivePurchaseAllowedTx(DB, userId, plan, GetDBTimestamp())
}

// PurchaseSubscriptionWithBalance creates a subscription by deducting the user's wallet quota.
// PurchaseSubscriptionWithBalance 余额购买套餐。成功时返回自动签发的
// 套餐专用 Key(裸串),供前端一次性展示。
func PurchaseSubscriptionWithBalance(userId int, planId int) (string, error) {
	if userId <= 0 || planId <= 0 {
		return "", errors.New("invalid userId or planId")
	}

	var logPlanTitle string
	var logMoney float64
	var chargedQuota int
	var upgradeGroup string
	var issuedKey string
	err := DB.Transaction(func(tx *gorm.DB) error {
		plan, err := getSubscriptionPlanByIdTx(tx, planId)
		if err != nil {
			return err
		}
		if !plan.Enabled {
			return errors.New("套餐未启用")
		}
		if plan.PriceAmount < 0 {
			return errors.New("套餐价格不能为负数")
		}
		if plan.AllowBalancePay != nil && !*plan.AllowBalancePay {
			return errors.New("该套餐不允许使用余额兑换")
		}
		if err := checkActivePurchaseAllowedTx(tx, userId, plan, GetDBTimestampTx(tx)); err != nil {
			return err
		}

		requiredQuota, err := calcSubscriptionBalanceQuota(plan.PriceAmount)
		if err != nil {
			return err
		}

		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if requiredQuota > 0 && user.Quota < requiredQuota {
			return errors.New("余额不足")
		}
		if requiredQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
				return err
			}
		}

		createdSub, err := CreateUserSubscriptionFromPlanTx(tx, userId, plan, PaymentMethodBalance)
		if err != nil {
			return err
		}
		issuedKey = createdSub.IssuedTokenKey

		now := common.GetTimestamp()
		tradeNo := fmt.Sprintf("SUBBALUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().UnixNano())
		order := &SubscriptionOrder{
			UserId:          userId,
			PlanId:          plan.Id,
			Money:           plan.PriceAmount,
			TradeNo:         tradeNo,
			PaymentMethod:   PaymentMethodBalance,
			PaymentProvider: PaymentProviderBalance,
			Status:          common.TopUpStatusSuccess,
			CreateTime:      now,
			CompleteTime:    now,
			ProviderPayload: fmt.Sprintf("charged_quota=%d", requiredQuota),
		}
		if err := tx.Create(order).Error; err != nil {
			return err
		}
		// 账单页数据源是 TopUp 表;余额购买此前不写入,导致账单里看不到这笔订单
		if err := upsertSubscriptionTopUpTx(tx, order, common.TopUpStatusSuccess, false); err != nil {
			return err
		}

		logPlanTitle = plan.Title
		logMoney = plan.PriceAmount
		chargedQuota = requiredQuota
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		return nil
	})
	if err != nil {
		return "", err
	}

	if chargedQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(chargedQuota)); err != nil {
			common.SysLog("failed to decrease user quota cache after subscription balance purchase: " + err.Error())
		}
	}
	if upgradeGroup != "" {
		_ = UpdateUserGroupCache(userId, upgradeGroup)
	}
	msg := fmt.Sprintf("使用余额购买订阅成功，套餐: %s，支付金额: %.2f，扣除额度: %d", logPlanTitle, logMoney, chargedQuota)
	RecordLog(userId, LogTypeTopup, msg)
	return issuedKey, nil
}

// GetAllActiveUserSubscriptions returns all active subscriptions for a user.
func GetAllActiveUserSubscriptions(userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var subs []UserSubscription
	err := DB.Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Order("end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

// HasActiveUserSubscription returns whether the user has any active subscription.
// This is a lightweight existence check to avoid heavy pre-consume transactions.
func HasActiveUserSubscription(userId int) (bool, error) {
	if userId <= 0 {
		return false, errors.New("invalid userId")
	}
	now := common.GetTimestamp()
	var count int64
	if err := DB.Model(&UserSubscription{}).
		Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now).
		Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// GetAllUserSubscriptions returns all subscriptions (active and expired) for a user.
func GetAllUserSubscriptions(userId int) ([]SubscriptionSummary, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	var subs []UserSubscription
	err := DB.Where("user_id = ?", userId).
		Order("end_time desc, id desc").
		Find(&subs).Error
	if err != nil {
		return nil, err
	}
	return buildSubscriptionSummaries(subs), nil
}

func buildSubscriptionSummaries(subs []UserSubscription) []SubscriptionSummary {
	if len(subs) == 0 {
		return []SubscriptionSummary{}
	}
	// 批量回填套餐名(一次查询,避免逐条 N+1)。planTitlesByIds 按主键直查,
	// 不带 enabled 过滤 —— 停用/下架的套餐,其存量订阅仍要显示正确的套餐名。
	titles := planTitlesByIds(distinctIDs(subs, func(s UserSubscription) int { return s.PlanId }))
	result := make([]SubscriptionSummary, 0, len(subs))
	for _, sub := range subs {
		subCopy := sub
		subCopy.PlanTitle = titles[subCopy.PlanId]
		result = append(result, SubscriptionSummary{
			Subscription: &subCopy,
		})
	}
	return result
}

// invalidateUserSubscriptionTx 在调用方事务内作废一条已锁定的订阅:
// 置 cancelled、立即结束、按需回退用户分组、联动禁用套餐专用 Key。
// 返回需要在事务提交后刷新的回退分组(空串表示无需回退)。
// 供管理员手动失效与订阅订单退款(撤销已发放订阅)复用,保证原子性。
func invalidateUserSubscriptionTx(tx *gorm.DB, sub *UserSubscription, now int64) (downgradeGroup string, err error) {
	if err = tx.Model(sub).Updates(map[string]interface{}{
		"status":     "cancelled",
		"end_time":   now,
		"updated_at": now,
	}).Error; err != nil {
		return "", err
	}
	target, err := downgradeUserGroupForSubscriptionTx(tx, sub, now)
	if err != nil {
		return "", err
	}
	// 联动禁用套餐专用 Key
	if _, err = DisableTokensBySubscriptionIdsTx(tx, []int{sub.Id}); err != nil {
		return "", err
	}
	return target, nil
}

// AdminInvalidateUserSubscription marks a user subscription as cancelled and ends it immediately.
func AdminInvalidateUserSubscription(userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		target, err := invalidateUserSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if userId > 0 {
		_ = InvalidateUserTokensCache(userId)
	}
	if cacheGroup != "" && userId > 0 {
		_ = UpdateUserGroupCache(userId, cacheGroup)
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(userSubscriptionId int) (string, error) {
	if userSubscriptionId <= 0 {
		return "", errors.New("invalid userSubscriptionId")
	}
	now := common.GetTimestamp()
	cacheGroup := ""
	downgradeGroup := ""
	var userId int
	err := DB.Transaction(func(tx *gorm.DB) error {
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
			return err
		}
		userId = sub.UserId
		target, err := downgradeUserGroupForSubscriptionTx(tx, &sub, now)
		if err != nil {
			return err
		}
		if target != "" {
			cacheGroup = target
			downgradeGroup = target
		}
		if err := tx.Where("id = ?", userSubscriptionId).Delete(&UserSubscription{}).Error; err != nil {
			return err
		}
		// 联动禁用套餐专用 Key(保留 token 记录以便审计,不随订阅硬删)
		if _, err := DisableTokensBySubscriptionIdsTx(tx, []int{userSubscriptionId}); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if userId > 0 {
		_ = InvalidateUserTokensCache(userId)
	}
	if cacheGroup != "" && userId > 0 {
		_ = UpdateUserGroupCache(userId, cacheGroup)
	}
	if downgradeGroup != "" {
		return fmt.Sprintf("用户分组将回退到 %s", downgradeGroup), nil
	}
	return "", nil
}

// AdminDeleteSubscriptionPlan 硬删除套餐,仅当它已无「在用」的引用。
//
// 拦截条件只有两条,都是「还在生效中」的引用:
//   - 仍然有效的用户订阅(status=active 且未到期):删了会让在用订阅指向不存在的
//     套餐 —— 门禁 applySubscriptionGate、桶判定 ResolveBucketForUserSubscription
//     都要靠 plan 反查,虽然它们失败时会保守回退,但会静默丢掉长上下文兜底与
//     basic 桶判定,等于用户花钱买的能力悄悄降级。
//   - pending 订单:用户正在支付。订单回调 CreateUserSubscriptionFromPlanTx 前会
//     GetSubscriptionPlanById,套餐没了会让这笔已付款的订单直接失败。
//
// 订阅到期(或取消)后即可删除:历史展示不依赖本表 —— 套餐名在请求时就已随
// subscription_plan_title 落进日志 other 字段,购买记录也把标题写死在消息文本里,
// 所以删掉过期套餐不会让任何历史记录丢失套餐名。
func AdminDeleteSubscriptionPlan(planId int) error {
	if planId <= 0 {
		return errors.New("invalid plan id")
	}
	now := common.GetTimestamp()
	err := DB.Transaction(func(tx *gorm.DB) error {
		var plan SubscriptionPlan
		if err := lockForUpdate(tx).Where("id = ?", planId).First(&plan).Error; err != nil {
			return err
		}

		var activeSubCount int64
		if err := tx.Model(&UserSubscription{}).
			Where("plan_id = ? AND status = ? AND end_time > ?", planId, "active", now).
			Count(&activeSubCount).Error; err != nil {
			return err
		}
		if activeSubCount > 0 {
			return fmt.Errorf(
				"该套餐还有 %d 个用户订阅未到期,无法删除。可先「停用」阻止新用户购买,待订阅全部到期后再删除",
				activeSubCount,
			)
		}

		var pendingOrderCount int64
		if err := tx.Model(&SubscriptionOrder{}).
			Where("plan_id = ? AND status = ?", planId, common.TopUpStatusPending).
			Count(&pendingOrderCount).Error; err != nil {
			return err
		}
		if pendingOrderCount > 0 {
			return fmt.Errorf(
				"该套餐有 %d 笔订单正在支付中,无法删除。请稍后再试",
				pendingOrderCount,
			)
		}

		return tx.Where("id = ?", planId).Delete(&SubscriptionPlan{}).Error
	})
	if err != nil {
		return err
	}
	InvalidateSubscriptionPlanCache(planId)
	return nil
}

type SubscriptionPreConsumeResult struct {
	UserSubscriptionId int
	Bucket             SubscriptionBucket
	PreConsumed        int64
	// 命中桶的总量/用量(premium 为 quota,basic 为 token 数)
	AmountTotal      int64
	AmountUsedBefore int64
	AmountUsedAfter  int64
}

// bucketBalance 返回订阅指定桶的 (total, used)。
func bucketBalance(sub *UserSubscription, bucket SubscriptionBucket) (int64, int64) {
	if bucket == BucketBasic {
		return sub.BasicTokenTotal, sub.BasicTokenUsed
	}
	return sub.AmountTotal, sub.AmountUsed
}

// bucketHasCapacity 判断指定桶能否再扣 amount。
// premium:0=无限(历史语义);basic:-1=无限,0=无此桶。
func bucketHasCapacity(sub *UserSubscription, bucket SubscriptionBucket, amount int64) bool {
	total, used := bucketBalance(sub, bucket)
	if bucket == BucketBasic {
		if total == BasicTokenUnlimited {
			return true
		}
		if total <= 0 {
			return false // 0 = 无基础桶
		}
		return total-used >= amount
	}
	if total <= 0 {
		return true // premium 历史语义:0 = 无限
	}
	return total-used >= amount
}

// addBucketUsed 对指定桶累加用量(可为负,调用方保证边界)。
func addBucketUsed(sub *UserSubscription, bucket SubscriptionBucket, delta int64) {
	if bucket == BucketBasic {
		sub.BasicTokenUsed += delta
	} else {
		sub.AmountUsed += delta
	}
}

// ExpireDueSubscriptions marks expired subscriptions and handles group downgrade.
func ExpireDueSubscriptions(limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var subs []UserSubscription
	if err := DB.Where("status = ? AND end_time > 0 AND end_time <= ?", "active", now).
		Order("end_time asc, id asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	expiredCount := 0
	userIds := make(map[int]struct{}, len(subs))
	for _, sub := range subs {
		if sub.UserId > 0 {
			userIds[sub.UserId] = struct{}{}
		}
	}
	for userId := range userIds {
		cacheGroup := ""
		tokensDisabled := false
		err := DB.Transaction(func(tx *gorm.DB) error {
			// 先取本事务将过期的订阅 id,供联动禁用套餐 Key
			var expiringIds []int
			if err := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND status = ? AND end_time > 0 AND end_time <= ?", userId, "active", now).
				Pluck("id", &expiringIds).Error; err != nil {
				return err
			}
			res := tx.Model(&UserSubscription{}).
				Where("user_id = ? AND status = ? AND end_time > 0 AND end_time <= ?", userId, "active", now).
				Updates(map[string]interface{}{
					"status":     "expired",
					"updated_at": common.GetTimestamp(),
				})
			if res.Error != nil {
				return res.Error
			}
			expiredCount += int(res.RowsAffected)
			if affected, err := DisableTokensBySubscriptionIdsTx(tx, expiringIds); err != nil {
				return err
			} else if len(affected) > 0 {
				tokensDisabled = true
			}

			// If there's an active upgraded subscription, keep current group.
			var activeSub UserSubscription
			activeQuery := tx.Where("user_id = ? AND status = ? AND end_time > ? AND upgrade_group <> ''",
				userId, "active", now).
				Order("end_time desc, id desc").
				Limit(1).
				Find(&activeSub)
			if activeQuery.Error == nil && activeQuery.RowsAffected > 0 {
				return nil
			}

			// No active upgraded subscription, downgrade to previous group if needed.
			var lastExpired UserSubscription
			expiredQuery := tx.Where("user_id = ? AND status = ? AND upgrade_group <> ''",
				userId, "expired").
				Order("end_time desc, id desc").
				Limit(1).
				Find(&lastExpired)
			if expiredQuery.Error != nil || expiredQuery.RowsAffected == 0 {
				return nil
			}
			upgradeGroup := strings.TrimSpace(lastExpired.UpgradeGroup)
			prevGroup := strings.TrimSpace(lastExpired.PrevUserGroup)
			if upgradeGroup == "" || prevGroup == "" {
				return nil
			}
			currentGroup, err := getUserGroupByIdTx(tx, userId)
			if err != nil {
				return err
			}
			if currentGroup != upgradeGroup || currentGroup == prevGroup {
				return nil
			}
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("group", prevGroup).Error; err != nil {
				return err
			}
			cacheGroup = prevGroup
			return nil
		})
		if err != nil {
			return expiredCount, err
		}
		if tokensDisabled {
			_ = InvalidateUserTokensCache(userId)
		}
		if cacheGroup != "" {
			_ = UpdateUserGroupCache(userId, cacheGroup)
		}
	}
	return expiredCount, nil
}

// SubscriptionPreConsumeRecord stores idempotent pre-consume operations per request.
type SubscriptionPreConsumeRecord struct {
	Id                 int    `json:"id"`
	RequestId          string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"index"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index"`
	PreConsumed        int64  `json:"pre_consumed" gorm:"type:bigint;not null;default:0"`
	// Bucket 记录预扣发生在哪个桶,退款按此路由回冲。历史行为空串,按 premium 处理。
	Bucket    string `json:"bucket" gorm:"type:varchar(16);default:''"`
	Status    string `json:"status" gorm:"type:varchar(32);index"` // consumed/refunded
	CreatedAt int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt int64  `json:"updated_at" gorm:"bigint;index"`
}

// recordBucket 归一化记录里的桶标识(空串=历史数据,按 premium 处理)。
func (r *SubscriptionPreConsumeRecord) recordBucket() SubscriptionBucket {
	if r.Bucket == string(BucketBasic) {
		return BucketBasic
	}
	return BucketPremium
}

func (r *SubscriptionPreConsumeRecord) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	r.CreatedAt = now
	r.UpdatedAt = now
	return nil
}

func (r *SubscriptionPreConsumeRecord) BeforeUpdate(tx *gorm.DB) error {
	r.UpdatedAt = common.GetTimestamp()
	return nil
}

func maybeResetUserSubscriptionWithPlanTx(tx *gorm.DB, sub *UserSubscription, plan *SubscriptionPlan, now int64) error {
	if tx == nil || sub == nil || plan == nil {
		return errors.New("invalid reset args")
	}
	if sub.NextResetTime > 0 && sub.NextResetTime > now {
		return nil
	}
	if NormalizeResetPeriod(plan.QuotaResetPeriod) == SubscriptionResetNever {
		return nil
	}
	baseUnix := sub.LastResetTime
	if baseUnix <= 0 {
		baseUnix = sub.StartTime
	}
	base := time.Unix(baseUnix, 0)
	next := calcNextResetTime(base, plan, sub.EndTime)
	advanced := false
	for next > 0 && next <= now {
		advanced = true
		base = time.Unix(next, 0)
		next = calcNextResetTime(base, plan, sub.EndTime)
	}
	if !advanced {
		if sub.NextResetTime == 0 && next > 0 {
			sub.NextResetTime = next
			sub.LastResetTime = base.Unix()
			return tx.Save(sub).Error
		}
		return nil
	}
	// 重置两桶一并清零(双桶共用一套重置调度,不做第二套周期)
	sub.AmountUsed = 0
	sub.BasicTokenUsed = 0
	sub.LastResetTime = base.Unix()
	sub.NextResetTime = next
	return tx.Save(sub).Error
}

// SubscriptionBucketBalances 是路由门禁用的轻量余额视图。
type SubscriptionBucketBalances struct {
	PremiumRemaining int64
	PremiumUnlimited bool
	BasicRemaining   int64
	BasicUnlimited   bool
	BasicConfigured  bool
}

// PremiumAvailable 高级桶是否还能扣。
func (b *SubscriptionBucketBalances) PremiumAvailable() bool {
	return b.PremiumUnlimited || b.PremiumRemaining > 0
}

// BasicAvailable 基础桶是否还能扣。
func (b *SubscriptionBucketBalances) BasicAvailable() bool {
	if !b.BasicConfigured {
		return false
	}
	return b.BasicUnlimited || b.BasicRemaining > 0
}

// GetSubscriptionBucketBalances 读取订阅双桶余额(单行主键查询,路由热路径用;
// UserSubscription 有意不进缓存以保证扣费正确性,此处读的是准实时值)。
func GetSubscriptionBucketBalances(userSubscriptionId int) (*SubscriptionBucketBalances, error) {
	if userSubscriptionId <= 0 {
		return nil, errors.New("invalid userSubscriptionId")
	}
	var sub UserSubscription
	if err := DB.Select("amount_total", "amount_used", "basic_token_total", "basic_token_used").
		Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
		return nil, err
	}
	out := &SubscriptionBucketBalances{
		// premium 历史语义:0 = 无限
		PremiumUnlimited: sub.AmountTotal <= 0,
		PremiumRemaining: sub.AmountTotal - sub.AmountUsed,
		BasicUnlimited:   sub.BasicTokenTotal == BasicTokenUnlimited,
		BasicConfigured:  sub.BasicTokenTotal != 0,
		BasicRemaining:   sub.BasicTokenTotal - sub.BasicTokenUsed,
	}
	return out, nil
}

// ResolveBucketForUserSubscription 判定「该订阅下,此模型走哪个桶」。
// 全程走缓存(planInfo 缓存 → plan 缓存 → PlanModelSet 内存缓存),relay 热路径可用。
// 任何一步失败都回退 premium(保守按贵桶扣)。
func ResolveBucketForUserSubscription(userSubscriptionId int, modelName string) SubscriptionBucket {
	if userSubscriptionId <= 0 {
		return BucketPremium
	}
	info, err := GetSubscriptionPlanInfoByUserSubscriptionId(userSubscriptionId)
	if err != nil || info == nil || info.PlanId <= 0 {
		return BucketPremium
	}
	plan, err := GetSubscriptionPlanById(info.PlanId)
	if err != nil || plan == nil {
		return BucketPremium
	}
	return ResolveModelBucket(plan, 0, modelName)
}

// PreConsumeUserSubscription 从用户的 active 订阅中按桶预扣额度。
// bucket 决定扣哪个桶及 amount 量纲(premium=quota,basic=token 数)。
// directedSubscriptionId > 0 时只尝试该订阅(套餐专用 Key 的定向扣费,D9),
// 不再遍历用户的其他订阅,也不回退。
func PreConsumeUserSubscription(requestId string, userId int, modelName string, bucket SubscriptionBucket, amount int64, directedSubscriptionId int) (*SubscriptionPreConsumeResult, error) {
	if userId <= 0 {
		return nil, errors.New("invalid userId")
	}
	if strings.TrimSpace(requestId) == "" {
		return nil, errors.New("requestId is empty")
	}
	if amount <= 0 {
		return nil, errors.New("amount must be > 0")
	}
	if bucket != BucketBasic {
		bucket = BucketPremium
	}
	now := GetDBTimestamp()

	returnValue := &SubscriptionPreConsumeResult{}

	fillFromExisting := func(rec *SubscriptionPreConsumeRecord, sub *UserSubscription) {
		recBucket := rec.recordBucket()
		total, used := bucketBalance(sub, recBucket)
		returnValue.UserSubscriptionId = sub.Id
		returnValue.Bucket = recBucket
		returnValue.PreConsumed = rec.PreConsumed
		returnValue.AmountTotal = total
		returnValue.AmountUsedBefore = used
		returnValue.AmountUsedAfter = used
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		var existing SubscriptionPreConsumeRecord
		query := tx.Where("request_id = ?", requestId).Limit(1).Find(&existing)
		if query.Error != nil {
			return query.Error
		}
		if query.RowsAffected > 0 {
			if existing.Status == "refunded" {
				return ErrSubscriptionPreConsumeRefunded
			}
			var sub UserSubscription
			if err := tx.Where("id = ?", existing.UserSubscriptionId).First(&sub).Error; err != nil {
				return err
			}
			fillFromExisting(&existing, &sub)
			return nil
		}

		var subs []UserSubscription
		subQuery := lockForUpdate(tx).
			Where("user_id = ? AND status = ? AND end_time > ?", userId, "active", now)
		if directedSubscriptionId > 0 {
			subQuery = subQuery.Where("id = ?", directedSubscriptionId)
		}
		if err := subQuery.Order("end_time asc, id asc").
			Find(&subs).Error; err != nil {
			// 保持既有语义:查询失败按"无可用订阅"处理(触发上层回退),
			// 但保留底层错误便于排查。
			return fmt.Errorf("%w: %v", ErrNoActiveSubscription, err)
		}
		if len(subs) == 0 {
			return ErrNoActiveSubscription
		}
		for _, candidate := range subs {
			sub := candidate
			plan, err := getSubscriptionPlanByIdTx(tx, sub.PlanId)
			if err != nil {
				return err
			}
			if err := maybeResetUserSubscriptionWithPlanTx(tx, &sub, plan, now); err != nil {
				return err
			}
			if !bucketHasCapacity(&sub, bucket, amount) {
				continue
			}
			_, usedBefore := bucketBalance(&sub, bucket)
			record := &SubscriptionPreConsumeRecord{
				RequestId:          requestId,
				UserId:             userId,
				UserSubscriptionId: sub.Id,
				PreConsumed:        amount,
				Bucket:             string(bucket),
				Status:             "consumed",
			}
			if err := tx.Create(record).Error; err != nil {
				var dup SubscriptionPreConsumeRecord
				if err2 := tx.Where("request_id = ?", requestId).First(&dup).Error; err2 == nil {
					if dup.Status == "refunded" {
						return ErrSubscriptionPreConsumeRefunded
					}
					fillFromExisting(&dup, &sub)
					return nil
				}
				return err
			}
			addBucketUsed(&sub, bucket, amount)
			if err := tx.Save(&sub).Error; err != nil {
				return err
			}
			total, usedAfter := bucketBalance(&sub, bucket)
			returnValue.UserSubscriptionId = sub.Id
			returnValue.Bucket = bucket
			returnValue.PreConsumed = amount
			returnValue.AmountTotal = total
			returnValue.AmountUsedBefore = usedBefore
			returnValue.AmountUsedAfter = usedAfter
			return nil
		}
		return fmt.Errorf("%w, bucket=%s need=%d", ErrSubscriptionQuotaInsufficient, bucket, amount)
	})
	if err != nil {
		return nil, err
	}
	return returnValue, nil
}

// RefundSubscriptionPreConsume is idempotent and refunds pre-consumed subscription quota by requestId.
func RefundSubscriptionPreConsume(requestId string) error {
	if strings.TrimSpace(requestId) == "" {
		return errors.New("requestId is empty")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record SubscriptionPreConsumeRecord
		if err := lockForUpdate(tx).
			Where("request_id = ?", requestId).First(&record).Error; err != nil {
			return err
		}
		if record.Status == "refunded" {
			return nil
		}
		if record.PreConsumed <= 0 {
			record.Status = "refunded"
			return tx.Save(&record).Error
		}
		// 必须走 tx 变体:此前调用 PostConsumeUserSubscriptionDelta 会在事务内
		// 用全局 DB 再开一个事务,回冲与置 refunded 不在同一原子域。
		// 回冲按预扣记录里的桶路由,保证退回到扣走的那个桶。
		if err := postConsumeUserSubscriptionDeltaTx(tx, record.UserSubscriptionId, record.recordBucket(), -record.PreConsumed); err != nil {
			return err
		}
		record.Status = "refunded"
		return tx.Save(&record).Error
	})
}

// ResetDueSubscriptions resets subscriptions whose next_reset_time has passed.
func ResetDueSubscriptions(limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	now := GetDBTimestamp()
	var subs []UserSubscription
	if err := DB.Where("next_reset_time > 0 AND next_reset_time <= ? AND status = ?", now, "active").
		Order("next_reset_time asc").
		Limit(limit).
		Find(&subs).Error; err != nil {
		return 0, err
	}
	if len(subs) == 0 {
		return 0, nil
	}
	resetCount := 0
	for _, sub := range subs {
		subCopy := sub
		plan, err := getSubscriptionPlanByIdTx(nil, sub.PlanId)
		if err != nil || plan == nil {
			continue
		}
		err = DB.Transaction(func(tx *gorm.DB) error {
			var locked UserSubscription
			if err := lockForUpdate(tx).
				Where("id = ? AND next_reset_time > 0 AND next_reset_time <= ?", subCopy.Id, now).
				First(&locked).Error; err != nil {
				return nil
			}
			if err := maybeResetUserSubscriptionWithPlanTx(tx, &locked, plan, now); err != nil {
				return err
			}
			resetCount++
			return nil
		})
		if err != nil {
			return resetCount, err
		}
	}
	return resetCount, nil
}

// CleanupSubscriptionPreConsumeRecords removes old idempotency records to keep table small.
func CleanupSubscriptionPreConsumeRecords(olderThanSeconds int64) (int64, error) {
	if olderThanSeconds <= 0 {
		olderThanSeconds = 7 * 24 * 3600
	}
	cutoff := GetDBTimestamp() - olderThanSeconds
	res := DB.Where("updated_at < ?", cutoff).Delete(&SubscriptionPreConsumeRecord{})
	return res.RowsAffected, res.Error
}

type SubscriptionPlanInfo struct {
	PlanId    int
	PlanTitle string
}

func GetSubscriptionPlanInfoByUserSubscriptionId(userSubscriptionId int) (*SubscriptionPlanInfo, error) {
	if userSubscriptionId <= 0 {
		return nil, errors.New("invalid userSubscriptionId")
	}
	cacheKey := fmt.Sprintf("sub:%d", userSubscriptionId)
	if cached, found, err := getSubscriptionPlanInfoCache().Get(cacheKey); err == nil && found {
		return &cached, nil
	}
	var sub UserSubscription
	if err := DB.Where("id = ?", userSubscriptionId).First(&sub).Error; err != nil {
		return nil, err
	}
	plan, err := getSubscriptionPlanByIdTx(nil, sub.PlanId)
	if err != nil {
		return nil, err
	}
	info := &SubscriptionPlanInfo{
		PlanId:    sub.PlanId,
		PlanTitle: plan.Title,
	}
	_ = getSubscriptionPlanInfoCache().SetWithTTL(cacheKey, *info, subscriptionPlanInfoCacheTTL())
	return info, nil
}

// Update subscription used amount by delta (positive consume more, negative refund).
func PostConsumeUserSubscriptionDelta(userSubscriptionId int, bucket SubscriptionBucket, delta int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		return postConsumeUserSubscriptionDeltaTx(tx, userSubscriptionId, bucket, delta)
	})
}

// postConsumeUserSubscriptionDeltaTx 在调用方事务内按增量调整指定桶的已用量,
// 供 RefundSubscriptionPreConsume 等已持有事务的路径复用,避免嵌套事务。
// delta 量纲随桶:premium=quota,basic=token 数。
func postConsumeUserSubscriptionDeltaTx(tx *gorm.DB, userSubscriptionId int, bucket SubscriptionBucket, delta int64) error {
	if userSubscriptionId <= 0 {
		return errors.New("invalid userSubscriptionId")
	}
	if delta == 0 {
		return nil
	}
	if bucket != BucketBasic {
		bucket = BucketPremium
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).
		Where("id = ?", userSubscriptionId).
		First(&sub).Error; err != nil {
		return err
	}
	total, used := bucketBalance(&sub, bucket)
	newUsed := used + delta
	if newUsed < 0 {
		newUsed = 0
	}
	// 有限桶不允许超总量(premium 的 0 与 basic 的 -1/0 均视为不设上限校验)
	if total > 0 && newUsed > total {
		return fmt.Errorf("subscription used exceeds total, bucket=%s used=%d total=%d", bucket, newUsed, total)
	}
	if bucket == BucketBasic {
		sub.BasicTokenUsed = newUsed
	} else {
		sub.AmountUsed = newUsed
	}
	return tx.Save(&sub).Error
}
