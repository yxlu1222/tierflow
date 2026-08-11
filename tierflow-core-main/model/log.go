package model

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/logger"
	"github.com/Zer0Echo/tierflow-core/pkg/billingexpr"
	"github.com/Zer0Echo/tierflow-core/types"

	"github.com/gin-gonic/gin"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

func applyExplicitLogTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if strings.Contains(value, "%") {
		pattern, err := sanitizeLikePattern(value)
		if err != nil {
			return nil, err
		}
		return tx.Where(column+" LIKE ? ESCAPE '!'", pattern), nil
	}
	return tx.Where(column+" = ?", value), nil
}

type Log struct {
	Id        int    `json:"id" gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId    int    `json:"user_id,omitempty" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type      int    `json:"type" gorm:"index:idx_created_at_type"`
	Content   string `json:"content"`
	Username  string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName string `json:"token_name" gorm:"index;default:''"`
	// Strategy 是**请求方案名**(用户请求里的 model 字段,如智能路由别名 auto)。
	//
	// 命名边界:本字段是链路第 ① 层「请求方案」,与另外两层严格区分 ——
	//   ② 命中的模型组 → ModelGroup(用户可见的抽象名)
	//   ③ 组内成员的上游模型 → other.auto_route_upstream(仅管理端可见)
	// 原名 ModelName 与 ModelGroupMember.ModelName(第③层上游模型名)、
	// ModelMeta.ModelName(模型元数据)等同名却不同义,故改为界限清晰的 Strategy。
	//
	// ⚠️ 物理列名保持 model_name 不变(column tag),既有裸 SQL 因此不受影响;
	// 本次只统一代码层与 JSON 契约的语义名。
	//
	// ⚠️ 单列索引**必须显式写名字** `index:idx_logs_model_name`,不能用裸 `index`:
	// GORM 给未命名索引取名是按 **Go 字段名**推的(schema/index.go 的 namer.IndexName),
	// 不是按列名。字段一改 Strategy,裸 `index` 就变成 idx_logs_strategy,而
	// AutoMigrate 的 HasIndex 按名字查、看不见形状相同的旧索引,于是每台升级机器启动时
	// 都会在 model_name 上再建一个一模一样的索引(大表阻塞数分钟 + 之后每条日志写入
	// 双倍成本)。这不是假设:开发库里已经长出来过一个,由 migrateLogStrategyIndex 清理。
	Strategy string `json:"strategy" gorm:"column:model_name;index:idx_logs_model_name;index:index_username_model_name,priority:1;default:''"`
	// ModelGroup 路由命中的模型组名快照(与 quota_data.model_group 同源)。
	// 财务"按模型营收"可直接 GROUP BY 本列，无需解析 other JSON。直连请求与
	// 非组路由为空——本列用户可见,不得写入真实上游模型名(抽象承诺)。
	ModelGroup   string `json:"model_group" gorm:"size:128;index;default:''"`
	Quota        int    `json:"quota" gorm:"default:0"`
	ProviderCost int    `json:"provider_cost" gorm:"default:0"` // 上游成本(quota 单位)，毛利 = Quota - ProviderCost
	// BillingSource 消费的资金来源:"wallet" | "subscription"。空 = 迁移前的历史数据，
	// 统计口径按 wallet 归一。资金看板按本列拆分钱包/订阅营收，不解析 Other JSON。
	BillingSource string `json:"billing_source" gorm:"type:varchar(16);default:''"`
	// SubscriptionBucket 订阅计费命中的额度桶:"premium" | "basic";钱包计费为空。
	// basic 桶量纲是 token 数、用户按月付固定费，Quota 只是名义售价 —— 拆出该列
	// 才能在看板上把这部分"名义营收"与钱包实扣区分开。
	SubscriptionBucket string `json:"subscription_bucket" gorm:"type:varchar(16);default:''"`
	PromptTokens       int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens   int    `json:"completion_tokens" gorm:"default:0"`
	UseTime            int    `json:"use_time" gorm:"default:0"`
	IsStream           bool   `json:"is_stream"`
	ChannelId          int    `json:"channel" gorm:"index"`
	ChannelName        string `json:"channel_name" gorm:"->"`
	TokenId            int    `json:"token_id" gorm:"default:0;index"`
	Group              string `json:"group" gorm:"index"`
	Ip                 string `json:"ip" gorm:"index;default:''"`
	RequestId          string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId  string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other              string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
)

func formatUserLogs(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].ChannelName = ""
		// 用户侧不下发内部自增 user_id(配合 json tag 的 omitempty 使字段消失)
		logs[i].UserId = 0
		var otherMap map[string]interface{}
		otherMap, _ = common.StrToMap(logs[i].Other)
		if otherMap != nil {
			// Remove admin-only debug fields.
			delete(otherMap, "admin_info")
			// delete(otherMap, "reject_reason")
			delete(otherMap, "stream_status")
		}
		logs[i].Other = common.MapToJsonStr(otherMap)
		logs[i].Id = startIdx + i + 1
	}
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order("id desc").Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

func RecordLog(userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLogWithAdminInfo 记录操作日志，并将管理员相关信息存入 Other.admin_info，
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo map[string]interface{}) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if len(adminInfo) > 0 {
		other := map[string]interface{}{
			"admin_info": adminInfo,
		}
		log.Other = common.MapToJsonStr(other)
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

func RecordTopupLog(userId int, content string, callerIp string, paymentMethod string, callbackPaymentMethod string) {
	username, _ := GetUsernameById(userId, false)
	adminInfo := map[string]interface{}{
		"server_ip":               common.GetIp(),
		"node_name":               common.NodeName,
		"caller_ip":               callerIp,
		"payment_method":          paymentMethod,
		"callback_payment_method": callbackPaymentMethod,
		"version":                 common.Version,
	}
	other := map[string]interface{}{
		"admin_info": adminInfo,
	}
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Ip:        callerIp,
		Other:     common.MapToJsonStr(other),
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		common.SysLog("failed to record topup log: " + err.Error())
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other map[string]interface{}) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, common.LocalLogPreview(content)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	otherStr := common.MapToJsonStr(other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		Strategy:         modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int `json:"channel_id"`
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	// Strategy 请求方案名(链路第 ① 层),写入 Log.Strategy;命名边界见 Log.Strategy
	Strategy       string                 `json:"strategy"`
	ModelGroup     string                 `json:"model_group"` // 路由命中的模型组名快照(第 ② 层);直连/非组路由为空(用户可见,禁落上游名)
	TokenName      string                 `json:"token_name"`
	Quota          int                    `json:"quota"`
	Content        string                 `json:"content"`
	TokenId        int                    `json:"token_id"`
	UseTimeSeconds int                    `json:"use_time_seconds"`
	IsStream       bool                   `json:"is_stream"`
	Group          string                 `json:"group"`
	Other          map[string]interface{} `json:"other"`
	// ProviderCost 是结算层已按「实际服务渠道 × 模型」解析好的上游成本(quota 单位)。
	// 非 nil 时直接采用(结算层权威值);nil 时回退到本函数内的遗留计算路径,以兼容
	// 未接入结算层重解析的其他调用点。
	ProviderCost *int `json:"provider_cost"`
	// BillingSource / SubscriptionBucket 透传自 relayInfo(见 Log 同名列注释);
	// 无订阅语境的调用点(如渠道测试)留空即可,统计时按 wallet 归一。
	BillingSource      string `json:"billing_source"`
	SubscriptionBucket string `json:"subscription_bucket"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	if !common.LogConsumeEnabled {
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	// 上游成本(quota 单位)，用于毛利可见。
	// 优先采用结算层已按「实际服务渠道 × 模型」解析好的权威值(params.ProviderCost)；
	// 未提供时回退到遗留计算(按模型名 + scalar token；缓存命中/写入单独计价)。
	// 默认行为：未显式配置上游成本的模型，成本 = 售价(毛利0)，避免显示虚假 100% 毛利。
	var providerCost int
	if params.ProviderCost != nil {
		providerCost = *params.ProviderCost
	} else {
		cacheReadTokens := otherInt(params.Other, "cache_tokens")
		cacheWriteTokens := otherInt(params.Other, "cache_write_tokens")
		if cacheWriteTokens == 0 {
			cacheWriteTokens = otherInt(params.Other, "cache_creation_tokens")
		}
		// 走表达式感知的解析链(表达式 -> 遗留扁平):成本配置可能已被模型编辑
		// 对话框迁移到 cost_expr,只读扁平表会让渠道测试/违规费日志误记 毛利0。
		cost, costConfigured := ComputeProviderCostExpr(params.ChannelId, params.Strategy,
			billingexpr.TokenParams{
				P:   float64(params.PromptTokens),
				C:   float64(params.CompletionTokens),
				Len: float64(params.PromptTokens),
				CR:  float64(cacheReadTokens),
				CC:  float64(cacheWriteTokens),
			}, billingexpr.RequestInput{},
			params.PromptTokens, params.CompletionTokens, cacheReadTokens, cacheWriteTokens)
		if !costConfigured {
			cost = params.Quota
		}
		providerCost = cost
	}
	if providerCost > 0 {
		if params.Other == nil {
			params.Other = map[string]interface{}{}
		}
		params.Other["provider_cost"] = providerCost
	}
	otherStr := common.MapToJsonStr(params.Other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:             userId,
		Username:           username,
		CreatedAt:          common.GetTimestamp(),
		Type:               LogTypeConsume,
		Content:            params.Content,
		PromptTokens:       params.PromptTokens,
		CompletionTokens:   params.CompletionTokens,
		TokenName:          params.TokenName,
		Strategy:           params.Strategy,
		ModelGroup:         params.ModelGroup,
		Quota:              params.Quota,
		ProviderCost:       providerCost,
		BillingSource:      params.BillingSource,
		SubscriptionBucket: params.SubscriptionBucket,
		ChannelId:          params.ChannelId,
		TokenId:            params.TokenId,
		UseTime:            params.UseTimeSeconds,
		IsStream:           params.IsStream,
		Group:              params.Group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := LOG_DB.Create(log).Error
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	if common.DataExportEnabled {
		gopool.Go(func() {
			LogQuotaData(userId, username, params.Strategy, params.ModelGroup, params.BillingSource, params.SubscriptionBucket, params.Quota, common.GetTimestamp(), params.PromptTokens+params.CompletionTokens)
		})
	}
}

// GetRoutingModelBreakdownFromLogs 从 logs 表计算"按请求方案展开的真实上游模型"看板数据(仅管理员)。
// 数据源为 logs:routed 请求的 model_name=别名、other.auto_route_upstream=真实上游模型。
// aliases 为请求方案的别名集合(选某方案=该方案别名;「全部方案」=所有方案别名)。只统计走了
// 路由(命中别名)且记录了真实上游的请求,按 (真实上游模型, 小时) 聚合 —— 结果只含真实模型,
// 不含别名,也不含未走路由的直连调用,以匹配"模型明细"视图的职责。
func GetRoutingModelBreakdownFromLogs(startTime int64, endTime int64, aliases []string) ([]*QuotaData, error) {
	if len(aliases) == 0 {
		return []*QuotaData{}, nil
	}
	type logRow struct {
		ModelName        string
		Other            string
		CreatedAt        int64
		Quota            int
		PromptTokens     int
		CompletionTokens int
	}
	var rows []logRow
	err := LOG_DB.Model(&Log{}).
		Select("model_name, other, created_at, quota, prompt_tokens, completion_tokens").
		Where("type = ? AND created_at >= ? AND created_at <= ? AND model_name IN ?",
			LogTypeConsume, startTime, endTime, aliases).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	type aggKey struct {
		model string
		hour  int64
	}
	agg := make(map[aggKey]*QuotaData)
	for _, r := range rows {
		otherMap, _ := common.StrToMap(r.Other)
		upstream := ""
		if otherMap != nil {
			if v, ok := otherMap["auto_route_upstream"].(string); ok {
				upstream = strings.TrimSpace(v)
			}
		}
		if upstream == "" {
			// 无真实上游(极少数旧路由日志缺字段)=> 无法归入真实模型,跳过,避免别名混入。
			continue
		}
		hour := r.CreatedAt - (r.CreatedAt % 3600) // 与 quota_data 一致,按小时分桶
		k := aggKey{model: upstream, hour: hour}
		qd, ok := agg[k]
		if !ok {
			qd = &QuotaData{Strategy: upstream, CreatedAt: hour}
			agg[k] = qd
		}
		qd.Count += 1
		qd.Quota += r.Quota
		qd.TokenUsed += r.PromptTokens + r.CompletionTokens
	}

	out := make([]*QuotaData, 0, len(agg))
	for _, qd := range agg {
		out = append(out, qd)
	}
	return out, nil
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", username); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	err = tx.Order("logs.created_at desc, logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	err = tx.Order("logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota int `json:"quota"`
	Rpm   int `json:"rpm"`
	Tpm   int `json:"tpm"`
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("sum(quota) quota")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, sum(prompt_tokens) + sum(completion_tokens) tpm")

	if tx, err = applyExplicitLogTextFilter(tx, "username", username); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "username", username); err != nil {
		return stat, err
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "model_name", modelName); err != nil {
		return stat, err
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("ifnull(sum(prompt_tokens),0) + ifnull(sum(completion_tokens),0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func DeleteOldLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	var total int64 = 0

	for {
		if nil != ctx.Err() {
			return total, ctx.Err()
		}

		result := LOG_DB.Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
		if nil != result.Error {
			return total, result.Error
		}

		total += result.RowsAffected

		if result.RowsAffected < int64(limit) {
			break
		}
	}

	return total, nil
}
