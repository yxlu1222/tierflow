package controller

import (
	"net/http"
	"strconv"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"

	"github.com/gin-gonic/gin"
)

func GetAllQuotaDates(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	username := c.Query("username")
	dates, err := model.GetAllQuotaDates(startTimestamp, endTimestamp, username)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}

// GetRoutingModelBreakdown 管理员看板：按"请求方案"展开的真实上游模型用量(数据源为 logs)。
// query: start_timestamp, end_timestamp, profile(可选 slug；空=全部方案)。
// 返回行的 model_name 即真实上游模型(不含请求方案别名)，前端可直接复用既有按 model_name 分组的图表逻辑。
func GetRoutingModelBreakdown(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	profile := c.Query("profile")

	// 确定要统计的别名集合：选某方案 => 该方案别名；「全部方案」=> 所有方案别名(只看走路由的流量)。
	var aliases []string
	var err error
	if profile != "" {
		aliases, err = model.GetRoutingAliasesBySlug(profile)
	} else {
		aliases, err = model.GetAllRoutingAliases()
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}

	dates, err := model.GetRoutingModelBreakdownFromLogs(startTimestamp, endTimestamp, aliases)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
}

func GetQuotaDatesByUser(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	dates, err := model.GetQuotaDataGroupByUser(startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
}

// GetFinanceData 管理员资金看板：充值(付费)/消费(营收)/上游成本/毛利 时间序列 + 区间状态 + 当前总余额。
// query: start_timestamp, end_timestamp(unix 秒，缺省时模型层回退到最近 7 天)。
func GetFinanceData(c *gin.Context) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	data, err := model.GetFinanceData(startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    data,
	})
}

func GetUserQuotaDates(c *gin.Context) {
	userId := c.GetInt("id")
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	// 判断时间跨度是否超过 1 个月
	if endTimestamp-startTimestamp > 2592000 {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "时间跨度不能超过 1 个月",
		})
		return
	}
	// billing_source 口径过滤:subscription=仅套餐 / wallet=仅按量付费(含历史
	// 空值行) / 其它值或缺省=全部。非法值静默按全部处理,与旧客户端兼容。
	billingSource := c.Query("billing_source")
	if billingSource != "subscription" && billingSource != "wallet" {
		billingSource = ""
	}
	dates, err := model.GetQuotaDataByUserId(userId, startTimestamp, endTimestamp, billingSource)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// 用户侧不下发内部自增 user_id(配合 json tag 的 omitempty 使字段消失)
	for i := range dates {
		dates[i].UserID = 0
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    dates,
	})
	return
}
