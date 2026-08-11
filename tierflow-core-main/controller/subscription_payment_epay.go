package controller

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

type SubscriptionEpayPayRequest struct {
	PlanId        int    `json:"plan_id"`
	PaymentMethod string `json:"payment_method"`
}

// launchSubscriptionEpay 拉起 epay 支付(新购与升级差价共用):解析回调地址、
// 调网关 Purchase、输出统一响应。任何失败都作废已创建的 pending 订单——
// 订单在调用前已落库,失败不作废会留下一张可被后续支付的孤儿单。
// 两条下单路径的网关交互必须走这一个函数,分开维护迟早行为漂移。
func launchSubscriptionEpay(c *gin.Context, client *epay.Client, tradeNo string, displayName string, money float64, payMethod string) {
	expireAndFail := func(msg string) {
		_ = model.ExpireSubscriptionOrder(tradeNo, model.PaymentProviderEpay)
		common.ApiErrorMsg(c, msg)
	}
	callBackAddress := service.GetCallbackAddress()
	returnUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/return")
	if err != nil {
		expireAndFail("回调地址配置错误")
		return
	}
	notifyUrl, err := url.Parse(callBackAddress + "/api/subscription/epay/notify")
	if err != nil {
		expireAndFail("回调地址配置错误")
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{
		Type:           payMethod,
		ServiceTradeNo: tradeNo,
		Name:           displayName,
		Money:          strconv.FormatFloat(money, 'f', 2, 64),
		Device:         epay.PC,
		NotifyUrl:      notifyUrl,
		ReturnUrl:      returnUrl,
	})
	if err != nil {
		expireAndFail("拉起支付失败")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "success", "data": params, "url": uri})
}

func SubscriptionRequestEpay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req SubscriptionEpayPayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}

	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐未启用")
		return
	}
	if plan.PriceAmount < 0.01 {
		common.ApiErrorMsg(c, "套餐金额过低")
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}

	userId := c.GetInt("id")
	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}
	// 有生效订阅时的新购守卫(同套餐续费放行;低/平级拦截;高档引导升级)。
	// 回调侧在交付事务内还会复检一次:下单与付款之间用户可能已购入更高档,
	// 那时交付会造出规则禁止的并存,回调将转 manual_review 而非自动发放。
	if err := model.CheckActivePurchaseAllowed(userId, plan); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}

	tradeNo := fmt.Sprintf("SUBUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())
	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           plan.PriceAmount,
		TradeNo:         tradeNo,
		PaymentMethod:   req.PaymentMethod,
		PaymentProvider: model.PaymentProviderEpay,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}
	if err := order.Insert(); err != nil {
		common.ApiErrorMsg(c, "创建订单失败")
		return
	}
	launchSubscriptionEpay(c, client, tradeNo, fmt.Sprintf("SUB:%s", plan.Title), plan.PriceAmount, req.PaymentMethod)
}

type SubscriptionUpgradeEpayRequest struct {
	SubscriptionId int    `json:"subscription_id"`
	PlanId         int    `json:"plan_id"`
	PaymentMethod  string `json:"payment_method"`
}

// SubscriptionUpgradeRequestEpay 在线支付升级差价:按报价差价创建 upgrade 订单
// 并拉起 epay,收款回调(SubscriptionEpayNotify/Return → CompleteSubscriptionOrder)
// 执行真正的升级(作废旧订阅→禁旧 Key→建新订阅)。
func SubscriptionUpgradeRequestEpay(c *gin.Context) {
	if !requirePaymentCompliance(c) {
		return
	}

	var req SubscriptionUpgradeEpayRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.SubscriptionId <= 0 || req.PlanId <= 0 {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	if !operation_setting.ContainsPayMethod(req.PaymentMethod) {
		common.ApiErrorMsg(c, "支付方式不存在")
		return
	}

	client := GetEpayClient()
	if client == nil {
		common.ApiErrorMsg(c, "当前管理员未配置支付信息")
		return
	}

	targetPlan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil || targetPlan == nil {
		common.ApiErrorMsg(c, "目标套餐不存在")
		return
	}

	userId := c.GetInt("id")
	tradeNo := fmt.Sprintf("SUBUPGEPAYUSR%dNO%s%d", userId, common.GetRandomString(6), time.Now().Unix())

	// 下单函数内做全套升级校验(active/只升不降/非同套餐/差价>0),
	// 并保证同一源订阅只有一张 pending 升级单
	_, quote, err := model.CreateSubscriptionUpgradeEpayOrder(userId, req.SubscriptionId, req.PlanId, tradeNo, req.PaymentMethod)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	launchSubscriptionEpay(c, client, tradeNo, fmt.Sprintf("SUBUPG:%s", targetPlan.Title), quote.AmountDue, req.PaymentMethod)
}

func SubscriptionEpayNotify(c *gin.Context) {
	var params map[string]string

	if c.Request.Method == "POST" {
		// POST 请求：从 POST body 解析参数
		if err := c.Request.ParseForm(); err != nil {
			_, _ = c.Writer.Write([]byte("fail"))
			return
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		// GET 请求：从 URL Query 解析参数
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}

	if len(params) == 0 {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	client := GetEpayClient()
	if client == nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	if verifyInfo.TradeStatus != epay.StatusTradeSuccess {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	LockOrder(verifyInfo.ServiceTradeNo)
	defer UnlockOrder(verifyInfo.ServiceTradeNo)

	// manual_review 也返回 success:钱已收、订单已落终态,必须停掉网关重试
	if _, err := model.CompleteSubscriptionOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type); err != nil {
		_, _ = c.Writer.Write([]byte("fail"))
		return
	}

	_, _ = c.Writer.Write([]byte("success"))
}

// SubscriptionEpayReturn handles browser return after payment.
// It verifies the payload and completes the order, then redirects to console.
func SubscriptionEpayReturn(c *gin.Context) {
	var params map[string]string

	if c.Request.Method == "POST" {
		// POST 请求：从 POST body 解析参数
		if err := c.Request.ParseForm(); err != nil {
			c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=fail"))
			return
		}
		params = lo.Reduce(lo.Keys(c.Request.PostForm), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.PostForm.Get(t)
			return r
		}, map[string]string{})
	} else {
		// GET 请求：从 URL Query 解析参数
		params = lo.Reduce(lo.Keys(c.Request.URL.Query()), func(r map[string]string, t string, i int) map[string]string {
			r[t] = c.Request.URL.Query().Get(t)
			return r
		}, map[string]string{})
	}

	if len(params) == 0 {
		c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=fail"))
		return
	}

	client := GetEpayClient()
	if client == nil {
		c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=fail"))
		return
	}
	verifyInfo, err := client.Verify(params)
	if err != nil || !verifyInfo.VerifyStatus {
		c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=fail"))
		return
	}
	if verifyInfo.TradeStatus == epay.StatusTradeSuccess {
		LockOrder(verifyInfo.ServiceTradeNo)
		defer UnlockOrder(verifyInfo.ServiceTradeNo)
		outcome, err := model.CompleteSubscriptionOrder(verifyInfo.ServiceTradeNo, common.GetJsonString(verifyInfo), model.PaymentProviderEpay, verifyInfo.Type)
		if err != nil {
			c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=fail"))
			return
		}
		// 转人工的订单不能渲染成「支付成功」——钱收了但什么都没发放,
		// 用户会带着已失效的 Key 继续调用;跳 pending 提示等待处理。
		if outcome == model.SubscriptionOrderOutcomeManualReview {
			c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=pending"))
			return
		}
		c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=success"))
		return
	}
	c.Redirect(http.StatusFound, paymentReturnPath("/console/topup?pay=pending"))
}
