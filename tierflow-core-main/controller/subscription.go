package controller

import (
	"errors"
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/Zer0Echo/tierflow-core/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// ---- Shared types ----

type SubscriptionPlanDTO struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

type SubscriptionBalancePayRequest struct {
	PlanId int `json:"plan_id"`
}

// ---- User APIs ----

func GetSubscriptionPlans(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, []SubscriptionPlanDTO{})
		return
	}

	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

func GetSubscriptionSelf(c *gin.Context) {
	userId := c.GetInt("id")

	// Get all subscriptions (including expired)
	allSubscriptions, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		allSubscriptions = []model.SubscriptionSummary{}
	}

	// Get active subscriptions for backward compatibility
	activeSubscriptions, err := model.GetAllActiveUserSubscriptions(userId)
	if err != nil {
		activeSubscriptions = []model.SubscriptionSummary{}
	}

	// 用户侧不下发内部自增 user_id(配合 json tag 的 omitempty 使字段消失)。
	// 管理端的 AdminListUserSubscriptions 复用同一结构体,故只能在此清而非改 tag。
	stripSubscriptionUserIds(activeSubscriptions)
	stripSubscriptionUserIds(allSubscriptions)

	common.ApiSuccess(c, gin.H{
		"subscriptions":     activeSubscriptions, // all active subscriptions
		"all_subscriptions": allSubscriptions,    // all subscriptions including expired
	})
}

// GetSubscriptionSelfToken 返回某条订阅的专用 Key(明文)。
// Key 只在这里下发:API 密钥页已不再收录套餐 Key。
func GetSubscriptionSelfToken(c *gin.Context) {
	userId := c.GetInt("id")
	subId, err := strconv.Atoi(c.Query("id"))
	if err != nil || subId <= 0 {
		common.ApiErrorMsg(c, "invalid subscription id")
		return
	}
	// 先单独校验归属:订阅不存在/不属于本人要报错,而「订阅在但没有 Key」
	// 不是错误——两者在 model 层都是 ErrRecordNotFound,分不开。
	if _, err := model.GetUserSubscriptionOwned(userId, subId); err != nil {
		common.ApiError(c, err)
		return
	}
	token, err := model.GetSubscriptionToken(userId, subId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 历史数据或人工写库绕过了签发:下发空 key,前端据此把按钮切成「签发 Key」
		common.ApiSuccess(c, gin.H{"key": ""})
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 与购买响应保持一致:下发带 sk- 前缀的可直接使用形式
	common.ApiSuccess(c, gin.H{
		"key":          "sk-" + token.GetFullKey(),
		"name":         token.Name,
		"status":       token.Status,
		"expired_time": token.ExpiredTime,
	})
}

// RotateSubscriptionSelfToken 重新签发专用 Key —— 旧 Key 立即失效。
func RotateSubscriptionSelfToken(c *gin.Context) {
	userId := c.GetInt("id")
	var req struct {
		Id int `json:"id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Id <= 0 {
		common.ApiErrorMsg(c, "invalid subscription id")
		return
	}
	key, err := model.RotateSubscriptionToken(userId, req.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"key": "sk-" + key})
}

func stripSubscriptionUserIds(items []model.SubscriptionSummary) {
	for i := range items {
		if items[i].Subscription != nil {
			items[i].Subscription.UserId = 0
		}
	}
}

func SubscriptionRequestBalancePay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId := c.GetInt("id")
	var req SubscriptionBalancePayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	issuedKey, err := model.PurchaseSubscriptionWithBalance(userId, req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 返回自动签发的套餐专用 Key(带 sk- 前缀),前端一次性展示
	common.ApiSuccess(c, gin.H{"token_key": "sk-" + issuedKey})
}

type SubscriptionUpgradeRequest struct {
	SubscriptionId int `json:"subscription_id"`
	PlanId         int `json:"plan_id"`
}

// SubscriptionUpgradeQuote 升级报价(只读):剩余价值 = 快照价 ÷ 30 × 剩余天数。
func SubscriptionUpgradeQuote(c *gin.Context) {
	userId := c.GetInt("id")
	subId, _ := strconv.Atoi(c.Query("subscription_id"))
	planId, _ := strconv.Atoi(c.Query("plan_id"))
	quote, err := model.QuoteSubscriptionUpgrade(userId, subId, planId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, quote)
}

// SubscriptionUpgrade 余额补差价升级(只升不降,D10)。
func SubscriptionUpgrade(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}
	userId := c.GetInt("id")
	var req SubscriptionUpgradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	issuedKey, quote, err := model.UpgradeSubscriptionWithBalance(userId, req.SubscriptionId, req.PlanId)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, gin.H{
		"token_key": "sk-" + issuedKey,
		"quote":     quote,
	})
}

// ---- Admin APIs ----

func AdminListSubscriptionPlans(c *gin.Context) {
	var plans []model.SubscriptionPlan
	if err := model.DB.Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	result := make([]SubscriptionPlanDTO, 0, len(plans))
	for _, p := range plans {
		p.NormalizeDefaults()
		result = append(result, SubscriptionPlanDTO{
			Plan: p,
		})
	}
	common.ApiSuccess(c, result)
}

type AdminUpsertSubscriptionPlanRequest struct {
	Plan model.SubscriptionPlan `json:"plan"`
}

func AdminCreateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	req.Plan.Id = 0
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	if req.Plan.AllowBalancePay == nil {
		req.Plan.AllowBalancePay = common.GetPointer(true)
	}
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorMsg(c, "总额度不能为负数")
		return
	}
	if req.Plan.BasicTokenTotal < model.BasicTokenUnlimited {
		common.ApiErrorMsg(c, "基础模型额度取值非法(-1=无限,0=无,正数=token 数)")
		return
	}
	if err := model.ValidatePlanModelSetId(req.Plan.PremiumSetId, "高级套餐模型组"); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.ValidatePlanModelSetId(req.Plan.BasicSetId, "基础套餐模型组"); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorMsg(c, "自定义重置周期需大于0秒")
		return
	}
	err := model.DB.Create(&req.Plan).Error
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(req.Plan.Id)
	common.ApiSuccess(c, req.Plan)
}

func AdminUpdateSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpsertSubscriptionPlanRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if strings.TrimSpace(req.Plan.Title) == "" {
		common.ApiErrorMsg(c, "套餐标题不能为空")
		return
	}
	if req.Plan.PriceAmount < 0 {
		common.ApiErrorMsg(c, "价格不能为负数")
		return
	}
	if req.Plan.PriceAmount > 9999 {
		common.ApiErrorMsg(c, "价格不能超过9999")
		return
	}
	req.Plan.Id = id
	if req.Plan.DurationUnit == "" {
		req.Plan.DurationUnit = model.SubscriptionDurationMonth
	}
	if req.Plan.DurationValue <= 0 && req.Plan.DurationUnit != model.SubscriptionDurationCustom {
		req.Plan.DurationValue = 1
	}
	if req.Plan.MaxPurchasePerUser < 0 {
		common.ApiErrorMsg(c, "购买上限不能为负数")
		return
	}
	if req.Plan.TotalAmount < 0 {
		common.ApiErrorMsg(c, "总额度不能为负数")
		return
	}
	if req.Plan.BasicTokenTotal < model.BasicTokenUnlimited {
		common.ApiErrorMsg(c, "基础模型额度取值非法(-1=无限,0=无,正数=token 数)")
		return
	}
	if err := model.ValidatePlanModelSetId(req.Plan.PremiumSetId, "高级套餐模型组"); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	if err := model.ValidatePlanModelSetId(req.Plan.BasicSetId, "基础套餐模型组"); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	req.Plan.UpgradeGroup = strings.TrimSpace(req.Plan.UpgradeGroup)
	if req.Plan.UpgradeGroup != "" {
		if _, ok := ratio_setting.GetGroupRatioCopy()[req.Plan.UpgradeGroup]; !ok {
			common.ApiErrorMsg(c, "升级分组不存在")
			return
		}
	}
	req.Plan.QuotaResetPeriod = model.NormalizeResetPeriod(req.Plan.QuotaResetPeriod)
	if req.Plan.QuotaResetPeriod == model.SubscriptionResetCustom && req.Plan.QuotaResetCustomSeconds <= 0 {
		common.ApiErrorMsg(c, "自定义重置周期需大于0秒")
		return
	}

	err := model.DB.Transaction(func(tx *gorm.DB) error {
		// update plan (allow zero values updates with map)
		updateMap := map[string]interface{}{
			"title":                      req.Plan.Title,
			"subtitle":                   req.Plan.Subtitle,
			"price_amount":               req.Plan.PriceAmount,
			"duration_unit":              req.Plan.DurationUnit,
			"duration_value":             req.Plan.DurationValue,
			"custom_seconds":             req.Plan.CustomSeconds,
			"enabled":                    req.Plan.Enabled,
			"sort_order":                 req.Plan.SortOrder,
			"recommended":                req.Plan.Recommended,
			"max_purchase_per_user":      req.Plan.MaxPurchasePerUser,
			"total_amount":               req.Plan.TotalAmount,
			"basic_token_total":          req.Plan.BasicTokenTotal,
			"premium_set_id":             req.Plan.PremiumSetId,
			"basic_set_id":               req.Plan.BasicSetId,
			"upgrade_group":              req.Plan.UpgradeGroup,
			"quota_reset_period":         req.Plan.QuotaResetPeriod,
			"quota_reset_custom_seconds": req.Plan.QuotaResetCustomSeconds,
			"updated_at":                 common.GetTimestamp(),
		}
		if req.Plan.AllowBalancePay != nil {
			updateMap["allow_balance_pay"] = *req.Plan.AllowBalancePay
		}
		if err := tx.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Updates(updateMap).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

type AdminUpdateSubscriptionPlanStatusRequest struct {
	Enabled *bool `json:"enabled"`
}

func AdminUpdateSubscriptionPlanStatus(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	var req AdminUpdateSubscriptionPlanStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if err := model.DB.Model(&model.SubscriptionPlan{}).Where("id = ?", id).Update("enabled", *req.Enabled).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	model.InvalidateSubscriptionPlanCache(id)
	common.ApiSuccess(c, nil)
}

// AdminDeleteSubscriptionPlan 删除套餐;仅限从未产生订阅/订单的套餐,
// 已售出的套餐由 AdminUpdateSubscriptionPlanStatus 停用。
func AdminDeleteSubscriptionPlan(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	id, _ := strconv.Atoi(c.Param("id"))
	if id <= 0 {
		common.ApiErrorMsg(c, "无效的ID")
		return
	}
	if err := model.AdminDeleteSubscriptionPlan(id); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, nil)
}

type AdminBindSubscriptionRequest struct {
	UserId int `json:"user_id"`
	PlanId int `json:"plan_id"`
}

func AdminBindSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req AdminBindSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.UserId <= 0 || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.AdminBindSubscription(req.UserId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: user subscription management ----

func AdminListUserSubscriptions(c *gin.Context) {
	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	subs, err := model.GetAllUserSubscriptions(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, subs)
}

type AdminCreateUserSubscriptionRequest struct {
	PlanId int `json:"plan_id"`
}

// AdminCreateUserSubscription creates a new user subscription from a plan (no payment).
func AdminCreateUserSubscription(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	userId, _ := strconv.Atoi(c.Param("id"))
	if userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户ID")
		return
	}
	var req AdminCreateUserSubscriptionRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	msg, err := model.AdminBindSubscription(userId, req.PlanId, "")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminInvalidateUserSubscription cancels a user subscription immediately.
func AdminInvalidateUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	msg, err := model.AdminInvalidateUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// AdminDeleteUserSubscription hard-deletes a user subscription.
func AdminDeleteUserSubscription(c *gin.Context) {
	subId, _ := strconv.Atoi(c.Param("id"))
	if subId <= 0 {
		common.ApiErrorMsg(c, "无效的订阅ID")
		return
	}
	msg, err := model.AdminDeleteUserSubscription(subId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if msg != "" {
		common.ApiSuccess(c, gin.H{"message": msg})
		return
	}
	common.ApiSuccess(c, nil)
}

// ---- Admin: subscription order management ----

func AdminListSubscriptionOrders(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	status := c.Query("status")
	orders, total, err := model.GetAllSubscriptionOrders(keyword, status, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(orders)
	common.ApiSuccess(c, pageInfo)
}

type AdminResolveSubscriptionOrderRequest struct {
	Action string `json:"action"`
}

// AdminResolveSubscriptionOrder 人工处理订阅订单:
// deliver=补发(manual_review→success,发放套餐);
// close=关单(manual_review→failed,管理员线下退款后标记);
// expire=作废(pending→expired,用户未支付的挂单);
// refund=标记退款(success→refunded,线下已退,并撤销已发放订阅)。
func AdminResolveSubscriptionOrder(c *gin.Context) {
	orderId, _ := strconv.Atoi(c.Param("id"))
	if orderId <= 0 {
		common.ApiErrorMsg(c, "无效的订单ID")
		return
	}
	var req AdminResolveSubscriptionOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	switch req.Action {
	case "deliver":
		msg, err := model.AdminDeliverSubscriptionOrder(orderId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"message": msg})
	case "close":
		if err := model.AdminCloseSubscriptionOrder(orderId); err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, nil)
	case "expire":
		if err := model.AdminExpireSubscriptionOrder(orderId); err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, nil)
	case "refund":
		msg, err := model.AdminRefundSubscriptionOrder(orderId)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"message": msg})
	default:
		common.ApiErrorMsg(c, "未知操作")
	}
}
