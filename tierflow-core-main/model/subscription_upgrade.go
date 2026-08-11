package model

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// 套餐升级(P5,D10:只升不降):
// 当前订阅剩余价值 = PaidMoney ÷ 30 × 剩余天数(向上取整),升级补差价。
// 事务:作废旧订阅(不触发分组回退)→ 禁用旧 Key → 余额扣差价 →
// 建新订阅(自动发新 Key,source=upgrade,不占购买上限)→ 记升级订单。

// SubscriptionUpgradeQuote 升级报价。金额均为人民币。
type SubscriptionUpgradeQuote struct {
	CurrentSubscriptionId int     `json:"current_subscription_id"`
	CurrentPlanId         int     `json:"current_plan_id"`
	CurrentPaidMoney      float64 `json:"current_paid_money"`
	RemainingDays         int     `json:"remaining_days"`
	RemainingValue        float64 `json:"remaining_value"`
	TargetPlanId          int     `json:"target_plan_id"`
	TargetPrice           float64 `json:"target_price"`
	AmountDue             float64 `json:"amount_due"`
}

// quoteUpgradeLocked 在已锁定 sub 的前提下计算报价。now 用 DB 时钟。
func quoteUpgradeLocked(sub *UserSubscription, targetPlan *SubscriptionPlan, now int64) (*SubscriptionUpgradeQuote, error) {
	if sub.Status != "active" || sub.EndTime <= now {
		return nil, errors.New("当前订阅已失效,无法升级")
	}
	if targetPlan.Id == sub.PlanId {
		return nil, errors.New("目标套餐与当前套餐相同")
	}
	// 只升不降:按当前订阅的价格快照与目标套餐现价比较
	if targetPlan.PriceAmount <= sub.PaidMoney {
		return nil, errors.New("仅支持升级到更高价格的套餐")
	}
	remainingDays := int(math.Ceil(float64(sub.EndTime-now) / 86400.0))
	if remainingDays > subscriptionPeriodDays {
		remainingDays = subscriptionPeriodDays
	}
	remainingValue, _ := decimal.NewFromFloat(sub.PaidMoney).
		Div(decimal.NewFromInt(subscriptionPeriodDays)).
		Mul(decimal.NewFromInt(int64(remainingDays))).
		Round(2).Float64()
	amountDue, _ := decimal.NewFromFloat(targetPlan.PriceAmount).
		Sub(decimal.NewFromFloat(remainingValue)).
		Round(2).Float64()
	if amountDue < 0 {
		amountDue = 0
	}
	return &SubscriptionUpgradeQuote{
		CurrentSubscriptionId: sub.Id,
		CurrentPlanId:         sub.PlanId,
		CurrentPaidMoney:      sub.PaidMoney,
		RemainingDays:         remainingDays,
		RemainingValue:        remainingValue,
		TargetPlanId:          targetPlan.Id,
		TargetPrice:           targetPlan.PriceAmount,
		AmountDue:             amountDue,
	}, nil
}

// QuoteSubscriptionUpgrade 只读报价(供前端确认页展示)。
func QuoteSubscriptionUpgrade(userId, currentSubId, targetPlanId int) (*SubscriptionUpgradeQuote, error) {
	if userId <= 0 || currentSubId <= 0 || targetPlanId <= 0 {
		return nil, errors.New("参数非法")
	}
	var sub UserSubscription
	if err := DB.Where("id = ? AND user_id = ?", currentSubId, userId).First(&sub).Error; err != nil {
		return nil, errors.New("订阅不存在")
	}
	targetPlan, err := GetSubscriptionPlanById(targetPlanId)
	if err != nil || targetPlan == nil {
		return nil, errors.New("目标套餐不存在")
	}
	if !targetPlan.Enabled {
		return nil, errors.New("目标套餐未启用")
	}
	return quoteUpgradeLocked(&sub, targetPlan, GetDBTimestamp())
}

// performUpgradeTx 升级的事务内核:作废旧订阅(不做分组回退)→ 禁旧 Key →
// 建新订阅(source=upgrade,不占购买上限)。余额升级与 epay 升级回调共用,
// 返回新订阅(含一次性签发的 Key 裸串)。调用方负责事务外的缓存失效与日志。
func performUpgradeTx(tx *gorm.DB, now int64, userId int, sub *UserSubscription, targetPlan *SubscriptionPlan) (*UserSubscription, error) {
	// 作废旧订阅。升级场景**不做分组回退**(马上升到新组,回退是错误行为),
	// 故不调 AdminInvalidate 那套,仅置状态 + 截止时间。
	if err := tx.Model(&UserSubscription{}).Where("id = ?", sub.Id).
		Updates(map[string]interface{}{
			"status":     "cancelled",
			"end_time":   now,
			"updated_at": common.GetTimestamp(),
		}).Error; err != nil {
		return nil, err
	}
	if _, err := DisableTokensBySubscriptionIdsTx(tx, []int{sub.Id}); err != nil {
		return nil, err
	}
	return CreateUserSubscriptionFromPlanTx(tx, userId, targetPlan, SubscriptionSourceUpgrade)
}

// expirePendingUpgradeOrdersTx 作废某源订阅上的 pending epay 升级单。
// 同一源订阅同时只允许一张待支付升级单;余额升级成功时也要作废之,
// 否则「先下 epay 单 → 余额升级 → 再支付旧单」会用一次差价换两次升级。
func expirePendingUpgradeOrdersTx(tx *gorm.DB, fromSubscriptionId int) error {
	return tx.Model(&SubscriptionOrder{}).
		Where("from_subscription_id = ? AND order_type = ? AND status = ?",
			fromSubscriptionId, SubscriptionOrderTypeUpgrade, common.TopUpStatusPending).
		Updates(map[string]interface{}{
			"status":        common.TopUpStatusExpired,
			"complete_time": common.GetTimestamp(),
		}).Error
}

// UpgradeSubscriptionWithBalance 余额补差价升级。返回 (新 Key 裸串, 报价, error)。
func UpgradeSubscriptionWithBalance(userId, currentSubId, targetPlanId int) (string, *SubscriptionUpgradeQuote, error) {
	if userId <= 0 || currentSubId <= 0 || targetPlanId <= 0 {
		return "", nil, errors.New("参数非法")
	}
	var issuedKey string
	var quote *SubscriptionUpgradeQuote
	var chargedQuota int
	var upgradeGroup string
	var logTitle string

	err := DB.Transaction(func(tx *gorm.DB) error {
		now := GetDBTimestampTx(tx)

		// 余额升级即刻生效,同源订阅上的 pending epay 升级单必须一并作废,
		// 防止其后续支付回调再触发一次升级(回调侧对已作废单转人工)。
		// 锁序约定:先动 subscription_orders 行、再锁 user_subscriptions,
		// 与回调 CompleteSubscriptionOrder(先锁订单、后锁源订阅)保持同序,
		// 否则 MySQL/PG 下回调与本路径并发会 AB-BA 死锁。
		if err := expirePendingUpgradeOrdersTx(tx, currentSubId); err != nil {
			return err
		}

		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ?", currentSubId, userId).First(&sub).Error; err != nil {
			return errors.New("订阅不存在")
		}
		targetPlan, err := getSubscriptionPlanByIdTx(tx, targetPlanId)
		if err != nil {
			return errors.New("目标套餐不存在")
		}
		if !targetPlan.Enabled {
			return errors.New("目标套餐未启用")
		}
		if targetPlan.AllowBalancePay != nil && !*targetPlan.AllowBalancePay {
			return errors.New("目标套餐不允许使用余额支付")
		}

		q, err := quoteUpgradeLocked(&sub, targetPlan, now)
		if err != nil {
			return err
		}
		quote = q

		// 差价 → quota(CNY 口径,同 calcSubscriptionBalanceQuota)
		requiredQuota, err := calcSubscriptionBalanceQuota(q.AmountDue)
		if err != nil {
			return err
		}
		var user User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&user).Error; err != nil {
			return err
		}
		if requiredQuota > 0 && user.Quota < requiredQuota {
			return errors.New("余额不足以支付升级差价")
		}
		if requiredQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", userId).
				Update("quota", gorm.Expr("quota - ?", requiredQuota)).Error; err != nil {
				return err
			}
		}

		newSub, err := performUpgradeTx(tx, now, userId, &sub, targetPlan)
		if err != nil {
			return err
		}
		issuedKey = newSub.IssuedTokenKey

		tradeNo := fmt.Sprintf("SUBUPGUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().UnixNano())
		order := &SubscriptionOrder{
			UserId:             userId,
			PlanId:             targetPlan.Id,
			Money:              q.AmountDue,
			TradeNo:            tradeNo,
			PaymentMethod:      PaymentMethodBalance,
			PaymentProvider:    PaymentProviderBalance,
			Status:             common.TopUpStatusSuccess,
			CreateTime:         common.GetTimestamp(),
			CompleteTime:       common.GetTimestamp(),
			OrderType:          SubscriptionOrderTypeUpgrade,
			UserSubscriptionId: newSub.Id,
			FromSubscriptionId: sub.Id,
			ProviderPayload: fmt.Sprintf("from_subscription=%d remaining_value=%.2f charged_quota=%d",
				sub.Id, q.RemainingValue, requiredQuota),
		}
		if err := tx.Create(order).Error; err != nil {
			return err
		}
		if err := upsertSubscriptionTopUpTx(tx, order, common.TopUpStatusSuccess, false); err != nil {
			return err
		}

		chargedQuota = requiredQuota
		upgradeGroup = strings.TrimSpace(targetPlan.UpgradeGroup)
		logTitle = targetPlan.Title
		return nil
	})
	if err != nil {
		return "", nil, err
	}

	if chargedQuota > 0 {
		if err := cacheDecrUserQuota(userId, int64(chargedQuota)); err != nil {
			common.SysLog("failed to decrease user quota cache after subscription upgrade: " + err.Error())
		}
	}
	_ = InvalidateUserTokensCache(userId)
	if upgradeGroup != "" {
		_ = UpdateUserGroupCache(userId, upgradeGroup)
	}
	RecordLog(userId, LogTypeTopup, fmt.Sprintf(
		"套餐升级成功,目标套餐: %s,剩余价值抵扣: %.2f,补差价: %.2f",
		logTitle, quote.RemainingValue, quote.AmountDue))
	return issuedKey, quote, nil
}

// CreateSubscriptionUpgradeEpayOrder 创建 epay 升级差价订单(pending,收款由
// 支付网关异步回调 CompleteSubscriptionOrder 完成升级)。
// 全套升级校验(active/只升不降/非同套餐)复用报价逻辑;差价 < 0.01 无法在线
// 支付(0 元差价走余额通道免支付)。同一源订阅仅保留一张 pending 升级单。
func CreateSubscriptionUpgradeEpayOrder(userId, currentSubId, targetPlanId int, tradeNo string, paymentMethod string) (*SubscriptionOrder, *SubscriptionUpgradeQuote, error) {
	if userId <= 0 || currentSubId <= 0 || targetPlanId <= 0 || tradeNo == "" {
		return nil, nil, errors.New("参数非法")
	}
	var order *SubscriptionOrder
	var quote *SubscriptionUpgradeQuote
	err := DB.Transaction(func(tx *gorm.DB) error {
		now := GetDBTimestampTx(tx)
		// 同一源订阅仅保留一张 pending 升级单。锁序:先动 subscription_orders、
		// 再锁 user_subscriptions,与回调路径同序(见 UpgradeSubscriptionWithBalance 注释)。
		if err := expirePendingUpgradeOrdersTx(tx, currentSubId); err != nil {
			return err
		}
		var sub UserSubscription
		if err := lockForUpdate(tx).
			Where("id = ? AND user_id = ?", currentSubId, userId).First(&sub).Error; err != nil {
			return errors.New("订阅不存在")
		}
		targetPlan, err := getSubscriptionPlanByIdTx(tx, targetPlanId)
		if err != nil {
			return errors.New("目标套餐不存在")
		}
		if !targetPlan.Enabled {
			return errors.New("目标套餐未启用")
		}
		q, err := quoteUpgradeLocked(&sub, targetPlan, now)
		if err != nil {
			return err
		}
		if q.AmountDue < 0.01 {
			return errors.New("升级差价为 0,请直接使用余额升级")
		}
		quote = q
		order = &SubscriptionOrder{
			UserId:          userId,
			PlanId:          targetPlan.Id,
			Money:           q.AmountDue,
			TradeNo:         tradeNo,
			PaymentMethod:   paymentMethod,
			PaymentProvider: PaymentProviderEpay,
			Status:          common.TopUpStatusPending,
			// DB 时钟:回调侧的 TTL 校验也用 DB now,两端同源;
			// 用各节点 app 时钟会因漂移误判「报价过期」或放行陈旧报价
			CreateTime:         now,
			OrderType:          SubscriptionOrderTypeUpgrade,
			FromSubscriptionId: sub.Id,
			// 报价快照仅作审计,回调按支付时点重新校验源订阅有效性
			ProviderPayload: fmt.Sprintf("quote: remaining_days=%d remaining_value=%.2f target_price=%.2f",
				q.RemainingDays, q.RemainingValue, q.TargetPrice),
		}
		return tx.Create(order).Error
	})
	if err != nil {
		return nil, nil, err
	}
	return order, quote, nil
}
