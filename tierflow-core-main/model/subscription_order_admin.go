package model

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"gorm.io/gorm"
)

// parseChargedQuota 从余额支付订单的 provider_payload 中解析实扣的 quota。
// 余额购买(subscription.go)与余额升级(subscription_upgrade.go)都写入
// "charged_quota=N";退款须据此原额退回钱包(余额支付无线下退款渠道)。
// 解析失败返回 0。
func parseChargedQuota(payload string) int64 {
	for _, field := range strings.Fields(payload) {
		if v, ok := strings.CutPrefix(field, "charged_quota="); ok {
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return 0
			}
			return n
		}
	}
	return 0
}

// parseRemainingValue 解析升级订单里「被抵扣掉的源订阅剩余价值」(¥)。
// 由 UpgradeSubscriptionWithBalance 以 "remaining_value=66.00" 写入。
//
// 第二个返回值区分「记录了 0」与「根本没记录」—— 退款金额不能把两者混为一谈。
// 注意 epay 升级单取不到:CompleteSubscriptionOrder 会用网关回调 JSON 覆盖
// ProviderPayload(model/subscription.go),下单时写入的报价随之销毁。
func parseRemainingValue(payload string) (float64, bool) {
	for _, field := range strings.Fields(payload) {
		if v, ok := strings.CutPrefix(field, "remaining_value="); ok {
			f, err := strconv.ParseFloat(v, 64)
			if err != nil {
				return 0, false
			}
			return f, true
		}
	}
	return 0, false
}

// SubscriptionOrderAdminView 管理端订阅订单视图,附用户名与套餐标题。
// PlanTitle 为实时反查(套餐已删则为空,前端按 plan_id 兜底展示)。
type SubscriptionOrderAdminView struct {
	SubscriptionOrder
	Username  string `json:"username"`
	PlanTitle string `json:"plan_title"`
}

func planTitlesByIds(ids []int) map[int]string {
	if len(ids) == 0 {
		return map[int]string{}
	}
	type row struct {
		Id    int
		Title string
	}
	var rows []row
	if err := DB.Model(&SubscriptionPlan{}).Select("id", "title").Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		return map[int]string{}
	}
	titleById := make(map[int]string, len(rows))
	for _, r := range rows {
		titleById[r.Id] = r.Title
	}
	return titleById
}

// GetAllSubscriptionOrders 管理员分页查询订阅订单,支持订单号关键字与状态过滤。
func GetAllSubscriptionOrders(keyword string, status string, pageInfo *common.PageInfo) ([]*SubscriptionOrderAdminView, int64, error) {
	var pattern string
	if keyword != "" {
		p, err := sanitizeLikePattern(keyword)
		if err != nil {
			return nil, 0, err
		}
		pattern = p
	}

	// Count 与 Find 同一读事务:分页 total 与本页数据取自同一快照,避免页数错位。
	var total int64
	var orders []*SubscriptionOrder
	err := DB.Transaction(func(tx *gorm.DB) error {
		query := tx.Model(&SubscriptionOrder{})
		if pattern != "" {
			query = query.Where("trade_no LIKE ? ESCAPE '!'", pattern)
		}
		if status != "" {
			query = query.Where("status = ?", status)
		}
		if err := query.Count(&total).Error; err != nil {
			return err
		}
		return query.Order("id desc").Limit(pageInfo.GetPageSize()).Offset(pageInfo.GetStartIdx()).Find(&orders).Error
	})
	if err != nil {
		common.SysError("failed to query subscription orders: " + err.Error())
		return nil, 0, errors.New("查询订阅订单失败")
	}

	names := usernamesByIds(distinctIDs(orders, func(o *SubscriptionOrder) int { return o.UserId }))
	titles := planTitlesByIds(distinctIDs(orders, func(o *SubscriptionOrder) int { return o.PlanId }))

	views := make([]*SubscriptionOrderAdminView, 0, len(orders))
	for _, o := range orders {
		views = append(views, &SubscriptionOrderAdminView{
			SubscriptionOrder: *o,
			Username:          names[o.UserId],
			PlanTitle:         titles[o.PlanId],
		})
	}
	return views, total, nil
}

// AdminDeliverSubscriptionOrder 人工补发转人工(manual_review)的订阅订单:
// 发放套餐、订单与 TopUp 镜像置 success。
//
// 新购订单仍走购买守卫与购买上限(与自动交付口径一致,冲突时把错误抛给管理员,
// 由其先处理冲突订阅或改走关单退款);升级差价单按 upgrade 来源发放完整新套餐
// (不占购买上限)——差价单金额小于套餐全价,是否补发由管理员人工判断。
func AdminDeliverSubscriptionOrder(orderId int) (string, error) {
	if orderId <= 0 {
		return "", errors.New("invalid order id")
	}
	var logUserId int
	var logPlanTitle string
	var logMoney float64
	var tradeNo string
	var upgradeGroup string
	// 升级补发会禁用源订阅的专用 Key,提交后必须失效 Token 缓存
	var tokensDisabled bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where("id = ?", orderId).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status != SubscriptionOrderStatusManualReview {
			return errors.New("仅转人工状态的订单可以补发")
		}
		plan, err := getSubscriptionPlanByIdTx(tx, order.PlanId)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errors.New("目标套餐已被删除,无法补发,请关闭订单并线下退款")
			}
			return err
		}
		var newSub *UserSubscription
		if order.OrderType == SubscriptionOrderTypeUpgrade {
			// 升级单必须走与自动回调完全相同的交付路径(performUpgradeTx):
			// 作废源订阅 + 禁用旧 Key + 建新订阅。此前这里直接调
			// CreateUserSubscriptionFromPlanTx,源订阅不作废、旧 Key 不禁用,
			// 用户只付了差价却同时持有两个生效套餐、两把可用 Key;而升级单
			// 刻意跳过购买守卫,没有任何兜底能发现这个双活状态。
			now := GetDBTimestampTx(tx)
			var sub UserSubscription
			subErr := lockForUpdate(tx).
				Where("id = ? AND user_id = ?", order.FromSubscriptionId, order.UserId).
				First(&sub).Error
			if subErr != nil && !errors.Is(subErr, gorm.ErrRecordNotFound) {
				return subErr
			}
			if subErr != nil || sub.Status != "active" || sub.EndTime <= now {
				// 源订阅已失效时按升级发放全套 = 用一次差价换一个完整套餐,
				// 正是 TTL/失效检查要堵的套利窗口。交回管理员决定(关单退款,
				// 或先处理源订阅再补发),不在这里静默放行。
				return errors.New("源订阅已失效,无法按升级补发;请关单退款或先处理源订阅")
			}
			s, err := performUpgradeTx(tx, now, order.UserId, &sub, plan)
			if err != nil {
				return err
			}
			newSub = s
			tokensDisabled = true
		} else {
			if err := checkActivePurchaseAllowedTx(tx, order.UserId, plan, GetDBTimestampTx(tx)); err != nil {
				return err
			}
			s, err := CreateUserSubscriptionFromPlanTx(tx, order.UserId, plan, "order")
			if err != nil {
				return err
			}
			newSub = s
		}
		order.UserSubscriptionId = newSub.Id
		order.Status = common.TopUpStatusSuccess
		order.CompleteTime = common.GetTimestamp()
		if err := upsertSubscriptionTopUpTx(tx, &order, common.TopUpStatusSuccess, true); err != nil {
			return err
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logPlanTitle = plan.Title
		logMoney = order.Money
		tradeNo = order.TradeNo
		upgradeGroup = strings.TrimSpace(plan.UpgradeGroup)
		return nil
	})
	if err != nil {
		return "", err
	}
	if tokensDisabled && logUserId > 0 {
		_ = InvalidateUserTokensCache(logUserId)
	}
	if upgradeGroup != "" && logUserId > 0 {
		_ = UpdateUserGroupCache(logUserId, upgradeGroup)
	}
	msg := fmt.Sprintf("管理员人工补发订阅订单，套餐: %s，支付金额: %.2f，订单号: %s", logPlanTitle, logMoney, tradeNo)
	RecordLog(logUserId, LogTypeTopup, msg)
	if upgradeGroup != "" {
		return fmt.Sprintf("补发成功,用户分组将升级到 %s", upgradeGroup), nil
	}
	return "补发成功", nil
}

// AdminCloseSubscriptionOrder 关闭转人工(manual_review)的订阅订单:
// 管理员线下退款后标记关单,订单与 TopUp 镜像置 failed(账单页据此显示失败,
// 而非「成功」)。已是 failed 时幂等返回。
func AdminCloseSubscriptionOrder(orderId int) error {
	if orderId <= 0 {
		return errors.New("invalid order id")
	}
	var logUserId int
	var logMsg string
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where("id = ?", orderId).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status == common.TopUpStatusFailed {
			return nil
		}
		if order.Status != SubscriptionOrderStatusManualReview {
			return errors.New("仅转人工状态的订单可以关闭")
		}
		order.Status = common.TopUpStatusFailed
		order.CompleteTime = common.GetTimestamp()
		if err := upsertSubscriptionTopUpTx(tx, &order, common.TopUpStatusFailed, true); err != nil {
			return err
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logMsg = fmt.Sprintf("管理员关闭转人工订阅订单（线下退款），支付金额: %.2f，订单号: %s", order.Money, order.TradeNo)
		return nil
	})
	if err != nil {
		return err
	}
	if logUserId > 0 {
		RecordLog(logUserId, LogTypeTopup, logMsg)
	}
	return nil
}

// AdminExpireSubscriptionOrder 作废未支付(pending)的订阅订单。作废后若网关
// 仍推来经验签的付款回调,CompleteSubscriptionOrder 会按既有语义转 manual_review,
// 收款不会丢。已是 expired 时幂等返回。
func AdminExpireSubscriptionOrder(orderId int) error {
	if orderId <= 0 {
		return errors.New("invalid order id")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where("id = ?", orderId).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status == common.TopUpStatusExpired {
			return nil
		}
		if order.Status != common.TopUpStatusPending {
			return errors.New("仅待支付状态的订单可以作废")
		}
		order.Status = common.TopUpStatusExpired
		order.CompleteTime = common.GetTimestamp()
		return tx.Save(&order).Error
	})
}

// AdminRefundSubscriptionOrder 标记已成功(success)订阅订单退款(线下已退):
// 订单与 TopUp 镜像置 refunded;若订单产出的订阅仍生效则一并撤销
// (取消订阅、立即结束、禁用专用 Key、回退分组),已过期/取消的订阅只标记不动。
// 已是 refunded 时幂等返回。
func AdminRefundSubscriptionOrder(orderId int) (string, error) {
	if orderId <= 0 {
		return "", errors.New("invalid order id")
	}
	now := common.GetTimestamp()
	var logUserId int
	var logMoney float64
	var tradeNo string
	var cacheGroup string
	var revoked bool
	var already bool
	var isBalance bool
	var creditedBack int64
	// upgradeCredit:升级单退还的「源订阅剩余价值」折算额度,单独记以便审计与提示
	var upgradeCredit int64
	err := DB.Transaction(func(tx *gorm.DB) error {
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where("id = ?", orderId).First(&order).Error; err != nil {
			return ErrSubscriptionOrderNotFound
		}
		if order.Status == common.TopUpStatusRefunded {
			already = true
			return nil
		}
		if order.Status != common.TopUpStatusSuccess {
			return errors.New("仅成功订单可标记退款")
		}
		// 兑换码订单没有任何可退的资金:用户当初付出的是一张一次性兑换码,
		// 而撤销订阅并不会把码还回去(redemption.Status 已置 Used 且不可逆)。
		// 若在此「退款」,结果是用户既失套餐又失码、补偿为零,管理员却看到成功提示。
		// 与余额订单实扣额度未知时的处置同理:拒绝自动退款,要求人工介入。
		// 只想收回套餐请改用「作废用户订阅」,补偿则另发一张兑换码。
		if order.PaymentProvider == PaymentProviderRedemption {
			return errors.New("该订单由兑换码开通,无资金可退且兑换码不会返还。如需收回套餐请使用「作废用户订阅」,如需补偿请另行发放兑换码")
		}
		// 撤销已发放订阅:仅当订阅仍生效才撤销,避免误动已过期/取消的订阅。
		if order.UserSubscriptionId > 0 {
			var sub UserSubscription
			subErr := lockForUpdate(tx).Where("id = ?", order.UserSubscriptionId).First(&sub).Error
			if subErr != nil && !errors.Is(subErr, gorm.ErrRecordNotFound) {
				return subErr
			}
			if subErr == nil && sub.Status == "active" {
				target, err := invalidateUserSubscriptionTx(tx, &sub, now)
				if err != nil {
					return err
				}
				cacheGroup = target
				revoked = true
			}
		}
		var creditQuota int64

		// 余额支付订单没有线下退款渠道:用户当初以钱包 quota 付款,退款必须把
		// 当初实扣的 quota 原额退回,否则用户既失订阅又失额度。epay 订单为线下
		// 现金退款,系统内无 quota 流动,不在此退。
		if order.PaymentProvider == PaymentProviderBalance {
			isBalance = true
			q := parseChargedQuota(order.ProviderPayload)
			if q <= 0 {
				// 解析不到实扣额度就**拒绝退款**,而不是退 0 后报「成功」。
				// 退 0 会让管理员以为额度已退回、不再手工补偿,而用户实际上
				// 既丢了订阅又没拿回钱。金额未知时必须人工介入。
				return fmt.Errorf("该余额订单未记录实扣额度(provider_payload=%q),无法自动退款,请人工核对后手工调整额度", order.ProviderPayload)
			}
			creditQuota += q
		}

		// 升级单退款:差价之外,还必须退还升级时被抵扣掉的源订阅剩余价值。
		//
		// 升级发生时 performUpgradeTx 已把源订阅作废(end_time 改写为 now),
		// 且本函数**不恢复**源订阅 —— 已确认的口径是「全额折现」:那部分用户
		// 已付、未消耗的价值折成额度退回。不退就等于凭空消失(用户既无生效订阅,
		// 又只拿回差价),而流程还会报成功,是最难发现的一类资金错误。
		if order.OrderType == SubscriptionOrderTypeUpgrade {
			remainingValue, ok := parseRemainingValue(order.ProviderPayload)
			if !ok {
				// 取不到就拒绝,绝不静默少退。epay 升级单会落到这里:回调用网关
				// JSON 覆盖了下单时写入的报价。要让它也能自动退,需把报价持久化到
				// 独立列(见 docs/enterprise-readiness.md §4bis)。
				return fmt.Errorf("该升级订单未记录被抵扣的剩余价值(provider_payload=%q),无法自动退款;请人工核算「差价 + 源订阅剩余价值」后手工处理", order.ProviderPayload)
			}
			credit, err := calcSubscriptionBalanceQuota(remainingValue)
			if err != nil {
				return err
			}
			upgradeCredit = int64(credit)
			creditQuota += upgradeCredit
		}

		if creditQuota > 0 {
			if err := tx.Model(&User{}).Where("id = ?", order.UserId).
				Update("quota", gorm.Expr("quota + ?", creditQuota)).Error; err != nil {
				return err
			}
			creditedBack = creditQuota
		}
		order.Status = common.TopUpStatusRefunded
		order.CompleteTime = now
		if err := upsertSubscriptionTopUpTx(tx, &order, common.TopUpStatusRefunded, true); err != nil {
			return err
		}
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		logUserId = order.UserId
		logMoney = order.Money
		tradeNo = order.TradeNo
		return nil
	})
	if err != nil {
		return "", err
	}
	if already {
		return "该订单已是退款状态", nil
	}
	if revoked && logUserId > 0 {
		_ = InvalidateUserTokensCache(logUserId)
	}
	if cacheGroup != "" && logUserId > 0 {
		_ = UpdateUserGroupCache(logUserId, cacheGroup)
	}
	if creditedBack > 0 && logUserId > 0 {
		if err := cacheIncrUserQuota(logUserId, creditedBack); err != nil {
			common.SysLog("failed to increase user quota cache after subscription refund: " + err.Error())
		}
	}
	if logUserId > 0 {
		RecordLog(logUserId, LogTypeTopup, fmt.Sprintf(
			"管理员标记订阅订单退款，支付金额: %.2f，订单号: %s，撤销订阅: %v，退回额度: %d（其中升级抵扣返还: %d）",
			logMoney, tradeNo, revoked, creditedBack, upgradeCredit))
	}
	// 面向管理员的结果提示:必须以 creditedBack 实际退回量为准,不能只看
	// isBalance —— 否则「余额单但退回 0」也会报「已退回钱包额度」,管理员据此
	// 不再手工补偿,而用户实际一分没拿回。(当前退回 0 的情形已在事务里直接
	// 拒绝,这里的分支是防止后续改动重新引入该假阳性。)
	suffix := ""
	if upgradeCredit > 0 {
		suffix = fmt.Sprintf("(含升级抵扣的源订阅剩余价值 %d)", upgradeCredit)
	}
	// epay 单的现金部分不经系统,必须提醒管理员线下退
	if !isBalance && creditedBack > 0 {
		suffix += ";订单差价请线下退款"
	}
	switch {
	case creditedBack > 0 && revoked:
		return fmt.Sprintf("已退回额度 %d%s,并撤销对应订阅", creditedBack, suffix), nil
	case creditedBack > 0:
		return fmt.Sprintf("已退回额度 %d%s", creditedBack, suffix), nil
	case revoked:
		return "已标记退款并撤销对应订阅(线下退款请另行处理)", nil
	default:
		return "已标记退款(线下退款请另行处理)", nil
	}
}
