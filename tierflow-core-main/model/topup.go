package model

import (
	"errors"
	"fmt"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/logger"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type TopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id,omitempty" gorm:"index"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no" gorm:"unique;type:varchar(255);index"`
	PaymentMethod   string  `json:"payment_method" gorm:"type:varchar(50)"`
	PaymentProvider string  `json:"payment_provider" gorm:"type:varchar(50);default:''"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
}

const (
	PaymentMethodBalance = "balance"
	// PaymentMethodRedemption:兑换码开通的订阅。金额记 0，但仍写订单与账单镜像，
	// 否则这笔订阅在 /billing 与管理端订单列表里完全不可见。
	PaymentMethodRedemption = "redemption"
)

const (
	PaymentProviderEpay       = "epay"
	PaymentProviderBalance    = "balance"
	PaymentProviderRedemption = "redemption"
)

var (
	ErrPaymentMethodMismatch = errors.New("payment method mismatch")
	ErrTopUpNotFound         = errors.New("topup not found")
	ErrTopUpStatusInvalid    = errors.New("topup status invalid")
)

func (topUp *TopUp) Insert() error {
	var err error
	err = DB.Create(topUp).Error
	return err
}

func (topUp *TopUp) Update() error {
	var err error
	err = DB.Save(topUp).Error
	return err
}

func GetTopUpById(id int) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("id = ?", id).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func GetTopUpByTradeNo(tradeNo string) *TopUp {
	var topUp *TopUp
	var err error
	err = DB.Where("trade_no = ?", tradeNo).First(&topUp).Error
	if err != nil {
		return nil
	}
	return topUp
}

func UpdatePendingTopUpStatus(tradeNo string, expectedPaymentProvider string, targetStatus string) error {
	if tradeNo == "" {
		return errors.New("未提供支付单号")
	}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	return DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return ErrTopUpNotFound
		}
		if expectedPaymentProvider != "" && topUp.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}

		topUp.Status = targetStatus
		return tx.Save(topUp).Error
	})
}

// topUpQueryWindowSeconds 限制充值记录查询的时间窗口（秒）。
const topUpQueryWindowSeconds int64 = 30 * 24 * 60 * 60

// topUpQueryCutoff 返回允许查询的最早 create_time（秒级 Unix 时间戳）。
func topUpQueryCutoff() int64 {
	return common.GetTimestamp() - topUpQueryWindowSeconds
}

func GetUserTopUps(userId int, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	// Start transaction
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	cutoff := topUpQueryCutoff()

	// Get total count within transaction
	err = tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, cutoff).Count(&total).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Get paginated topups within same transaction
	err = tx.Where("user_id = ? AND create_time >= ?", userId, cutoff).Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error
	if err != nil {
		tx.Rollback()
		return nil, 0, err
	}

	// Commit transaction
	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}

	return topups, total, nil
}

// searchTopUpCountHardLimit 搜索充值记录时 COUNT 的安全上限，
// 防止对超大表执行无界 COUNT 触发 DoS。
const searchTopUpCountHardLimit = 10000

// TopUpAdminView 管理端充值订单视图,附用户名与来源。
// Source: "wallet" = 真实钱包充值;"subscription" = 订阅订单在充值表里的镜像行
// (amount 恒为 0)。镜像行的状态变更须走订阅订单页,充值页只读展示。
type TopUpAdminView struct {
	TopUp
	Username string `json:"username"`
	Source   string `json:"source"`
}

const (
	TopUpSourceWallet       = "wallet"
	TopUpSourceSubscription = "subscription"
)

// subscriptionOrderTradeNoSet 返回给定订单号中属于订阅订单的集合(用于标记
// TopUp 里的订阅镜像行)。查询失败时返回空集,调用方据此按钱包单降级展示。
func subscriptionOrderTradeNoSet(tradeNos []string) map[string]struct{} {
	out := make(map[string]struct{}, len(tradeNos))
	if len(tradeNos) == 0 {
		return out
	}
	var found []string
	if err := DB.Model(&SubscriptionOrder{}).Where("trade_no IN ?", tradeNos).Pluck("trade_no", &found).Error; err != nil {
		common.SysError("failed to detect subscription trade_nos: " + err.Error())
		return out
	}
	for _, t := range found {
		out[t] = struct{}{}
	}
	return out
}

// GetAllTopUpsAdmin 管理员分页查询全平台充值订单(不限时间窗),
// 支持订单号关键字与状态过滤,并回填用户名。
func GetAllTopUpsAdmin(keyword string, status string, pageInfo *common.PageInfo) ([]*TopUpAdminView, int64, error) {
	var pattern string
	if keyword != "" {
		p, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			return nil, 0, perr
		}
		pattern = p
	}

	// Count 与 Find 放进同一读事务,保证分页 total 与本页数据取自同一快照
	// (与 GetUserTopUps/SearchUserTopUps 口径一致),避免并发插入导致页数错位。
	var total int64
	var topups []*TopUp
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&TopUp{})
		if pattern != "" {
			query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
		}
		if status != "" {
			query = query.Where("status = ?", status)
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		return query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error
	})
	if err != nil {
		common.SysError("failed to query topups: " + err.Error())
		return nil, 0, errors.New("查询充值记录失败")
	}

	names := usernamesByIds(distinctIDs(topups, func(t *TopUp) int { return t.UserId }))
	tradeNos := make([]string, 0, len(topups))
	for _, t := range topups {
		tradeNos = append(tradeNos, t.TradeNo)
	}
	subTradeNos := subscriptionOrderTradeNoSet(tradeNos)

	views := make([]*TopUpAdminView, 0, len(topups))
	for _, t := range topups {
		source := TopUpSourceWallet
		if _, ok := subTradeNos[t.TradeNo]; ok {
			source = TopUpSourceSubscription
		}
		views = append(views, &TopUpAdminView{
			TopUp:    *t,
			Username: names[t.UserId],
			Source:   source,
		})
	}
	return views, total, nil
}

// SearchUserTopUps 按订单号搜索某用户的充值记录
func SearchUserTopUps(userId int, keyword string, pageInfo *common.PageInfo) (topups []*TopUp, total int64, err error) {
	tx := DB.Begin()
	if tx.Error != nil {
		return nil, 0, tx.Error
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	query := tx.Model(&TopUp{}).Where("user_id = ? AND create_time >= ?", userId, topUpQueryCutoff())
	if keyword != "" {
		pattern, perr := sanitizeLikePattern(keyword)
		if perr != nil {
			tx.Rollback()
			return nil, 0, perr
		}
		query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
	}

	if err = query.Limit(searchTopUpCountHardLimit).Count(&total).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to count search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&topups).Error; err != nil {
		tx.Rollback()
		common.SysError("failed to search topups: " + err.Error())
		return nil, 0, errors.New("搜索充值记录失败")
	}

	if err = tx.Commit().Error; err != nil {
		return nil, 0, err
	}
	return topups, total, nil
}

// ManualCompleteTopUp 管理员手动完成订单并给用户充值
func ManualCompleteTopUp(tradeNo string, callerIp string) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	var userId int
	var quotaToAdd int
	var payMoney float64
	var paymentMethod string

	err := DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		// 行级锁，避免并发补单
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return errors.New("充值订单不存在")
		}

		// 幂等处理：已成功直接返回
		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return errors.New("订单状态不是待支付，无法补单")
		}

		// 已下线的支付网关（Stripe/Creem/Waffo/Waffo Pancake）遗留的待支付订单
		// 不能在此补单：各网关的额度换算规则不同（如 Stripe 用 Money*QuotaPerUnit，
		// Creem 直接把 Amount 当作额度单位），且这些代码路径已删除。若走下面的通用
		// 易支付公式（Amount*QuotaPerUnit）会错发额度，故直接拒绝，交由人工处理。
		switch topUp.PaymentProvider {
		case "stripe", "creem", "waffo", "waffo_pancake":
			return errors.New("该订单使用的支付方式已下线，无法补单，请人工处理")
		}

		// 计算应充值额度：
		// - 订单（如易支付）：Amount 为美元数量，* QuotaPerUnit
		dAmount := decimal.NewFromInt(topUp.Amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd = int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		// 标记完成
		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}

		// 增加用户额度（立即写库，保持一致性）
		if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).Update("quota", gorm.Expr("quota + ?", quotaToAdd)).Error; err != nil {
			return err
		}

		userId = topUp.UserId
		payMoney = topUp.Money
		paymentMethod = topUp.PaymentMethod
		return nil
	})

	if err != nil {
		return err
	}

	// 事务外记录日志，避免阻塞
	RecordTopupLog(userId, fmt.Sprintf("管理员补单成功，充值金额: %v，支付金额：%f", logger.FormatQuota(quotaToAdd), payMoney), callerIp, paymentMethod, "admin")
	return nil
}

// isSubscriptionMirrorTradeNoTx 判断该订单号是否为订阅订单在充值表里的镜像行。
// 镜像行的资金/交付以 SubscriptionOrder 为准,充值页不得对其做状态变更。
func isSubscriptionMirrorTradeNoTx(tx *gorm.DB, tradeNo string) (bool, error) {
	var count int64
	if err := tx.Model(&SubscriptionOrder{}).Where("trade_no = ?", tradeNo).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// ⚠️ 刻意不提供「作废待支付充值单」的管理动作。
//
// 钱包充值的入账闸门是 EpayNotify 里的 `status == pending` 判断:只有仍处于
// pending 的订单才会在收到已验签付款回调时发放额度。把 pending 改成任何终态
// (expired 等)就等于销毁了「后到的付款仍能入账」这唯一前提 —— 用户付了钱、
// 网关已被回 success 不再重试,而系统里既无额度也无告警,只能人工改库补救。
//
// 订阅订单可以作废,是因为 CompleteSubscriptionOrder 对 expired 订单收到付款
// 有明确出口(转 manual_review,见 model/subscription.go 的 toManualReview);
// 钱包侧没有这条出口,所以宁可让陈旧的 pending 行留在列表里(管理员用状态
// 过滤即可隐藏),也不引入这个静默丢钱的入口。
//
// 若将来要恢复该动作,必须先给钱包侧补齐等价的 manual_review 通道。

// AdminRefundTopUp 标记已成功(success)钱包充值订单退款(线下已退),
// 并回收此前发放的额度(quota = Amount × QuotaPerUnit),回收额度下取到 0
// 不使余额变负(记录少收差额)。已是 refunded 时幂等返回。
// 订阅镜像行与已下线网关拒绝(换算规则不同,须人工处理)。
func AdminRefundTopUp(tradeNo string, callerIp string) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}
	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	var userId int
	var clawedBack int
	var shortfall int
	var payMoney float64
	var paymentMethod string
	var already bool

	err := DB.Transaction(func(tx *gorm.DB) error {
		topUp := &TopUp{}
		if err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(topUp).Error; err != nil {
			return errors.New("充值订单不存在")
		}
		if isSub, err := isSubscriptionMirrorTradeNoTx(tx, tradeNo); err != nil {
			return err
		} else if isSub {
			return errors.New("该订单来自订阅订单，请在订阅订单页标记退款")
		}
		switch topUp.PaymentProvider {
		case "stripe", "creem", "waffo", "waffo_pancake":
			return errors.New("该订单使用的支付方式已下线，无法自动退款，请人工处理")
		}
		if topUp.Status == common.TopUpStatusRefunded {
			already = true
			return nil
		}
		if topUp.Status != common.TopUpStatusSuccess {
			return errors.New("仅成功订单可标记退款")
		}

		// 回收已发放额度,下取到 0(不使余额变负)
		dAmount := decimal.NewFromInt(topUp.Amount)
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		credited := int(dAmount.Mul(dQuotaPerUnit).IntPart())
		if credited > 0 {
			var user User
			if err := lockForUpdate(tx).Where("id = ?", topUp.UserId).First(&user).Error; err != nil {
				return err
			}
			deduct := credited
			if deduct > user.Quota {
				deduct = user.Quota
				shortfall = credited - user.Quota
			}
			if deduct > 0 {
				if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).
					Update("quota", gorm.Expr("quota - ?", deduct)).Error; err != nil {
					return err
				}
			}
			clawedBack = deduct
		}

		topUp.Status = common.TopUpStatusRefunded
		topUp.CompleteTime = common.GetTimestamp()
		if err := tx.Save(topUp).Error; err != nil {
			return err
		}
		userId = topUp.UserId
		payMoney = topUp.Money
		paymentMethod = topUp.PaymentMethod
		return nil
	})
	if err != nil {
		return err
	}
	if already {
		return nil
	}
	if clawedBack > 0 {
		if err := cacheDecrUserQuota(userId, int64(clawedBack)); err != nil {
			common.SysLog("failed to decrease user quota cache after topup refund: " + err.Error())
		}
	}
	if userId > 0 {
		msg := fmt.Sprintf("管理员标记退款（线下已退），支付金额：%f，回收额度：%s", payMoney, logger.FormatQuota(clawedBack))
		if shortfall > 0 {
			msg += fmt.Sprintf("，余额不足少收：%s", logger.FormatQuota(shortfall))
		}
		RecordTopupLog(userId, msg, callerIp, paymentMethod, "admin")
	}
	return nil
}
