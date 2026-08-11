package controller

import (
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/i18n"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
)

func GetAllRedemptions(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.GetAllRedemptions(pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func SearchRedemptions(c *gin.Context) {
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)
	redemptions, total, err := model.SearchRedemptions(keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(redemptions)
	common.ApiSuccess(c, pageInfo)
	return
}

func GetRedemption(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	redemption, err := model.GetRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    redemption,
	})
	return
}

// validateRedemptionTypeAndPlan 校验兑换码的类型与套餐绑定，创建/更新共用。
// 校验不通过时已写好响应，调用方直接 return 即可。
//
// type 必须落在已定义的取值内：未知值会让 IsSubscriptionType() 返回 false，
// 于是这张码悄悄按额度码发放，而管理端 UI 又会回退显示「额度」标签把脏数据盖住。
func validateRedemptionTypeAndPlan(c *gin.Context, redemption *model.Redemption) bool {
	switch redemption.Type {
	case common.RedemptionTypeQuota:
		// 额度码不携带套餐，避免脏数据在类型切换后残留
		redemption.PlanId = 0
	case common.RedemptionTypeSubscription:
		// 订阅码的面额由套餐决定，兑换路径根本不读 quota；与额度码清 plan_id 对称
		// 地清零，避免列表「面额」列展示一个无意义的原始值，也避免这张码日后被改
		// 回额度码时带出一个没人设置过的面额。
		redemption.Quota = 0
		// 订阅码必须绑定一个真实存在的套餐，否则兑换时才发现套餐不存在，
		// 用户拿到的是一张注定失败的码
		if redemption.PlanId <= 0 {
			common.ApiErrorI18n(c, i18n.MsgRedemptionPlanRequired)
			return false
		}
		if _, err := model.GetSubscriptionPlanById(redemption.PlanId); err != nil {
			common.ApiErrorI18n(c, i18n.MsgRedemptionPlanMissing)
			return false
		}
	default:
		common.ApiErrorI18n(c, i18n.MsgRedemptionTypeInvalid)
		return false
	}
	return true
}

func AddRedemption(c *gin.Context) {
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiErrorI18n(c, i18n.MsgPaymentComplianceRequired)
		return
	}

	redemption := model.Redemption{}
	err := c.ShouldBindJSON(&redemption)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if utf8.RuneCountInString(redemption.Name) == 0 || utf8.RuneCountInString(redemption.Name) > 20 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionNameLength)
		return
	}
	if redemption.Count <= 0 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountPositive)
		return
	}
	if redemption.Count > 100 {
		common.ApiErrorI18n(c, i18n.MsgRedemptionCountMax)
		return
	}
	if valid, msg := validateExpiredTime(c, redemption.ExpiredTime); !valid {
		c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
		return
	}
	if !validateRedemptionTypeAndPlan(c, &redemption) {
		return
	}
	var keys []string
	for i := 0; i < redemption.Count; i++ {
		key := common.GetUUID()
		cleanRedemption := model.Redemption{
			UserId:      c.GetInt("id"),
			Name:        redemption.Name,
			Key:         key,
			CreatedTime: common.GetTimestamp(),
			Quota:       redemption.Quota,
			ExpiredTime: redemption.ExpiredTime,
			Type:        redemption.Type,
			PlanId:      redemption.PlanId,
		}
		err = cleanRedemption.Insert()
		if err != nil {
			common.SysError("failed to insert redemption: " + err.Error())
			c.JSON(http.StatusOK, gin.H{
				"success": false,
				"message": i18n.T(c, i18n.MsgRedemptionCreateFailed),
				"data":    keys,
			})
			return
		}
		keys = append(keys, key)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    keys,
	})
	return
}

func DeleteRedemption(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	err := model.DeleteRedemptionById(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
	})
	return
}

func UpdateRedemption(c *gin.Context) {
	statusOnly := c.Query("status_only")

	// 两段式绑定：先只取 id 定位记录，再把【现有记录】作为种子二次绑定。
	//
	// 直接 ShouldBindJSON 到零值结构体会让「请求体里没写的字段」与「显式写了零值」
	// 不可区分，而 Redemption.Update() 用 Select 白名单强写这些列（Select 会把零值也
	// 写进去），于是一个只想改名的 PUT —— {id, name} —— 会把 type/plan_id/quota/
	// expired_time 一起清零：订阅码被静默改写成一张面额 0 的额度码，管理端显示
	// 「额度码 ¥0.00」，兑换它的用户既拿不到订阅也拿不到余额，而码照样被消耗。
	// 用现有值做种子后，省略的字段保持原值，写了的字段才覆盖。
	//
	// ShouldBindBodyWith 会缓存请求体，可重复绑定；普通 ShouldBindJSON 读一次就没了。
	var idOnly struct {
		Id int `json:"id"`
	}
	if err := c.ShouldBindBodyWith(&idOnly, binding.JSON); err != nil {
		common.ApiError(c, err)
		return
	}
	cleanRedemption, err := model.GetRedemptionById(idOnly.Id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	redemption := *cleanRedemption
	if err := c.ShouldBindBodyWith(&redemption, binding.JSON); err != nil {
		common.ApiError(c, err)
		return
	}
	if statusOnly == "" {
		// 已兑换的码不允许再改发放内容：它已经交付过一份额度或订阅，改 type/plan_id
		// 会让这条记录声称发放了 B，而实际交付的订阅与订单仍是 A，兑换台账无法再
		// 用于核对谁拿到了什么。（改名等展示字段同样拦下，保持账目不可变。）
		if cleanRedemption.Status == common.RedemptionCodeStatusUsed {
			common.ApiErrorI18n(c, i18n.MsgRedemptionUsedImmutable)
			return
		}
		if valid, msg := validateExpiredTime(c, redemption.ExpiredTime); !valid {
			c.JSON(http.StatusOK, gin.H{"success": false, "message": msg})
			return
		}
		if !validateRedemptionTypeAndPlan(c, &redemption) {
			return
		}
		// If you add more fields, please also update redemption.Update()
		cleanRedemption.Name = redemption.Name
		cleanRedemption.Quota = redemption.Quota
		cleanRedemption.ExpiredTime = redemption.ExpiredTime
		cleanRedemption.Type = redemption.Type
		cleanRedemption.PlanId = redemption.PlanId
	}
	if statusOnly != "" {
		// 已兑换的码同样不允许改状态：把 Used 改回 Enabled 会让这张码被兑换第二
		// 次——UsedUserId/RedeemedTime 被覆盖，首次兑换的台账被静默抹掉，订阅码
		// 还会再开一份订阅 + 再签发一把 Key。前端行操作里的 canToggle 只是 UI 门，
		// 直接 PUT 就能绕过，守卫必须落在这里。
		// 如需撤销已发放的订阅，走「作废用户订阅」，而不是把码改回可用。
		if cleanRedemption.Status == common.RedemptionCodeStatusUsed &&
			redemption.Status != common.RedemptionCodeStatusUsed {
			common.ApiErrorI18n(c, i18n.MsgRedemptionUsedStatusImmutable)
			return
		}
		cleanRedemption.Status = redemption.Status
	}
	err = cleanRedemption.Update()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    cleanRedemption,
	})
	return
}

func DeleteInvalidRedemption(c *gin.Context) {
	rows, err := model.DeleteInvalidRedemptions()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    rows,
	})
	return
}

func validateExpiredTime(c *gin.Context, expired int64) (bool, string) {
	if expired != 0 && expired < common.GetTimestamp() {
		return false, i18n.T(c, i18n.MsgRedemptionExpireTimeInvalid)
	}
	return true, ""
}
