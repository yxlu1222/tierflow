package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/logger"
	"github.com/Zer0Echo/tierflow-core/middleware"
	"github.com/Zer0Echo/tierflow-core/model"
	perfmetrics "github.com/Zer0Echo/tierflow-core/pkg/perf_metrics"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"
	"github.com/Zer0Echo/tierflow-core/relay"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
	relayconstant "github.com/Zer0Echo/tierflow-core/relay/constant"
	"github.com/Zer0Echo/tierflow-core/relay/helper"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/Zer0Echo/tierflow-core/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/samber/lo"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/tidwall/sjson"
)

func relayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	switch info.RelayMode {
	case relayconstant.RelayModeImagesGenerations, relayconstant.RelayModeImagesEdits:
		err = relay.ImageHelper(c, info)
	case relayconstant.RelayModeAudioSpeech:
		fallthrough
	case relayconstant.RelayModeAudioTranslation:
		fallthrough
	case relayconstant.RelayModeAudioTranscription:
		err = relay.AudioHelper(c, info)
	case relayconstant.RelayModeRerank:
		err = relay.RerankHelper(c, info)
	case relayconstant.RelayModeEmbeddings:
		err = relay.EmbeddingHelper(c, info)
	case relayconstant.RelayModeResponses, relayconstant.RelayModeResponsesCompact:
		err = relay.ResponsesHelper(c, info)
	default:
		err = relay.TextHelper(c, info)
	}
	return err
}

func geminiRelayHandler(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	var err *types.NewAPIError
	if strings.Contains(c.Request.URL.Path, "embed") {
		err = relay.GeminiEmbeddingHandler(c, info)
	} else {
		err = relay.GeminiHelper(c, info)
	}
	return err
}

func Relay(c *gin.Context, relayFormat types.RelayFormat) {

	requestId := c.GetString(common.RequestIdKey)
	//group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	//originalModel := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)

	var (
		newAPIError *types.NewAPIError
		ws          *websocket.Conn
	)

	if relayFormat == types.RelayFormatOpenAIRealtime {
		var err error
		ws, err = upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			helper.WssError(c, ws, types.NewError(err, types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry()).ToOpenAIError())
			return
		}
		defer ws.Close()
	}

	defer func() {
		if newAPIError != nil {
			logger.LogError(c, fmt.Sprintf("relay error: %s", common.LocalLogPreview(newAPIError.Error())))
			newAPIError.SetMessage(common.MessageWithRequestId(newAPIError.Error(), requestId))
			switch relayFormat {
			case types.RelayFormatOpenAIRealtime:
				helper.WssError(c, ws, newAPIError.ToOpenAIError())
			case types.RelayFormatClaude:
				c.JSON(newAPIError.StatusCode, gin.H{
					"type":  "error",
					"error": newAPIError.ToClaudeError(),
				})
			default:
				c.JSON(newAPIError.StatusCode, gin.H{
					"error": newAPIError.ToOpenAIError(),
				})
			}
		}
	}()

	request, err := helper.GetAndValidateRequest(c, relayFormat)
	if err != nil {
		// Map "request body too large" to 413 so clients can handle it correctly
		if common.IsRequestBodyTooLargeError(err) || errors.Is(err, common.ErrRequestBodyTooLarge) {
			newAPIError = types.NewErrorWithStatusCode(err, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
		} else {
			newAPIError = types.NewError(err, types.ErrorCodeInvalidRequest)
		}
		return
	}

	relayInfo, err := relaycommon.GenRelayInfo(c, relayFormat, request, ws)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeGenRelayInfoFailed)
		return
	}

	needSensitiveCheck := setting.ShouldCheckPromptSensitive()
	needCountToken := constant.CountToken
	// Avoid building huge CombineText (strings.Join) when token counting and sensitive check are both disabled.
	var meta *types.TokenCountMeta
	if needSensitiveCheck || needCountToken {
		meta = request.GetTokenCountMeta()
	} else {
		meta = fastTokenCountMetaForPricing(request)
	}

	if needSensitiveCheck && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			logger.LogWarn(c, fmt.Sprintf("user sensitive words detected: %s", strings.Join(words, ", ")))
			newAPIError = types.NewError(err, types.ErrorCodeSensitiveWordsDetected)
			return
		}
	}

	tokens, err := service.EstimateRequestToken(c, meta, relayInfo)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeCountTokenFailed)
		return
	}

	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(c, relayInfo, tokens, meta)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
		return
	}

	// common.SetContextKey(c, constant.ContextKeyTokenCountMeta, meta)

	if priceData.FreeModel {
		logger.LogInfo(c, fmt.Sprintf("模型 %s 免费，跳过预扣费", relayInfo.OriginModelName))
	} else {
		newAPIError = service.PreConsumeBilling(c, priceData.QuotaToPreConsume, relayInfo)
		if newAPIError != nil {
			return
		}
	}

	defer func() {
		// Only return quota if downstream failed and quota was actually pre-consumed
		if newAPIError != nil {
			newAPIError = service.NormalizeViolationFeeError(newAPIError)
			if relayInfo.Billing != nil {
				relayInfo.Billing.Refund(c)
			}
			service.ChargeViolationFeeIfNeeded(c, relayInfo, newAPIError)
		}
	}()

	retryParam := &service.RetryParam{
		Ctx:        c,
		TokenGroup: relayInfo.TokenGroup,
		ModelName:  relayInfo.OriginModelName,
		Retry:      common.GetPointer(0),
	}
	relayInfo.RetryIndex = 0
	relayInfo.LastError = nil

	// Single-request key rotation (TierFlow HA): on a KEY-scoped failure of a
	// multi-key channel, retry another untried key of the SAME channel before
	// failing over to a different channel. attempts is a hard ceiling on total
	// upstream tries; stickyChannel, when set, forces re-using that channel for a
	// key rotation (bypassing pool selection and the RetryTimes budget).
	attempts := 0
	maxTotalAttempts := operation_setting.RouteMaxTotalAttempts
	if maxTotalAttempts < 1 {
		maxTotalAttempts = common.RetryTimes + 1
	}
	var stickyChannel *model.Channel

	for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
		if attempts >= maxTotalAttempts {
			break
		}
		relayInfo.RetryIndex = retryParam.GetRetry()
		if stickyChannel == nil {
			// Skip channels ABANDONED this request so a retry fails over to a
			// different upstream instead of re-picking a given-up-on one.
			retryParam.ExcludeChannelIds = excludedChannelSet(c)
			// 模型组路由(G2)：仅重试时推进到下一个可用成员(渠道+上游模型名)。attempt 0
			// 已由 AutoRoute+Distribute 精确落到首个成员，非重试的常规路径完全不受影响。
			if retryParam.GetRetry() > 0 {
				advanceModelGroupMemberForAttempt(c, relayInfo, retryParam)
			}
		}
		channel, channelErr := getChannel(c, relayInfo, retryParam, stickyChannel)
		if channelErr != nil {
			logger.LogError(c, channelErr.Error())
			newAPIError = channelErr
			break
		}

		attempts++
		addUsedChannel(c, channel.Id)
		// Multi-key status comes from CONTEXT (set by Distribute at attempt 0 and by
		// SetupContextForSelectedChannel on retries), not from channel.ChannelInfo:
		// the attempt-0 channel is a minimal synthesized struct without ChannelInfo,
		// so channel.ChannelInfo.IsMultiKey would be a false negative there.
		isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
		usedKeyIndex := breakerKeyIndex(c, isMultiKey)
		// Remember which key was used so a same-channel rotation skips it.
		if isMultiKey {
			retryParam.MarkKeyTried(channel.Id, usedKeyIndex)
		}
		bodyStorage, bodyErr := common.GetBodyStorage(c)
		if bodyErr != nil {
			// Ensure consistent 413 for oversized bodies even when error occurs later (e.g., retry path)
			if common.IsRequestBodyTooLargeError(bodyErr) || errors.Is(bodyErr, common.ErrRequestBodyTooLarge) {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
			} else {
				newAPIError = types.NewErrorWithStatusCode(bodyErr, types.ErrorCodeReadRequestBodyFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
			}
			break
		}
		c.Request.Body = io.NopCloser(bodyStorage)

		switch relayFormat {
		case types.RelayFormatOpenAIRealtime:
			newAPIError = relay.WssHelper(c, relayInfo)
		case types.RelayFormatClaude:
			newAPIError = relay.ClaudeHelper(c, relayInfo)
		case types.RelayFormatGemini:
			newAPIError = geminiRelayHandler(c, relayInfo)
		default:
			newAPIError = relayHandler(c, relayInfo)
		}

		if newAPIError == nil {
			relayInfo.LastError = nil
			routehealth.RecordSuccess(channel.Id, usedKeyIndex)
			return
		}

		newAPIError = service.NormalizeViolationFeeError(newAPIError)
		relayInfo.LastError = newAPIError

		processChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, isMultiKey, common.GetContextKeyString(c, constant.ContextKeyChannelKey), channel.GetAutoBan()), newAPIError)

		// KEY-scoped failure on a multi-key channel with inner budget left → rotate
		// to another key of the SAME channel (stay sticky, do NOT consume the
		// cross-channel RetryTimes budget). The attempt-0 channel is synthesized
		// without key data, so fetch the real channel from cache for the rotation.
		if operation_setting.RouteKeyRotationEnabled &&
			isMultiKey &&
			operation_setting.IsKeyScopedStatusCode(newAPIError.StatusCode) &&
			!types.IsSkipRetryError(newAPIError) &&
			retryParam.KeyRotationsUsed[channel.Id] < operation_setting.RouteKeyRotationMaxPerChannel &&
			attempts < maxTotalAttempts {
			if realCh, chErr := model.CacheGetChannel(channel.Id); chErr == nil &&
				realCh.HasUntriedEnabledKey(retryParam.TriedKeysFor(channel.Id)) {
				if retryParam.KeyRotationsUsed == nil {
					retryParam.KeyRotationsUsed = make(map[int]int)
				}
				retryParam.KeyRotationsUsed[channel.Id]++
				stickyChannel = realCh
				retryParam.ResetRetryNextTry() // key rotation is free of the RetryTimes budget
				continue
			}
		}

		abandonChannel(c, channel.Id)
		stickyChannel = nil
		if !shouldRetry(c, newAPIError, common.RetryTimes-retryParam.GetRetry()) {
			break
		}
	}

	useChannel := c.GetStringSlice("use_channel")
	if len(useChannel) > 1 {
		retryLogStr := fmt.Sprintf("重试：%s", strings.Trim(strings.Join(strings.Fields(fmt.Sprint(useChannel)), "->"), "[]"))
		logger.LogInfo(c, retryLogStr)
	}
	if newAPIError != nil {
		gopool.Go(func() {
			perfmetrics.RecordRelaySample(relayInfo, false, 0)
		})
	}
}

var upgrader = websocket.Upgrader{
	Subprotocols: []string{"realtime"}, // WS 握手支持的协议，如果有使用 Sec-WebSocket-Protocol，则必须在此声明对应的 Protocol TODO add other protocol
	CheckOrigin: func(r *http.Request) bool {
		return true // 允许跨域
	},
}

func addUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
}

// abandonChannel marks a channel as given-up-on for this request so channel
// selection (and model-group member advance) skips it on later attempts. This is
// deliberately separate from use_channel (the retry log trail): a channel being
// key-rotated is in use_channel but NOT abandoned, so it can be re-selected to
// try another of its keys. It is abandoned only once its keys are exhausted or
// the failure was channel-scoped.
func abandonChannel(c *gin.Context, channelId int) {
	abandoned := c.GetStringSlice("abandoned_channel")
	abandoned = append(abandoned, fmt.Sprintf("%d", channelId))
	c.Set("abandoned_channel", abandoned)
}

// advanceModelGroupMemberForAttempt 在模型组路由的重试尝试里推进到下一个可用成员。
//
// 异构成员=各成员 (channelId, upstreamModelName) 可各不相同，故故障转移必须逐成员：
// 挑下一个未试过且熔断可用的成员，把请求体 model / relayInfo.OriginModelName / retryParam.ModelName
// 都改写为该成员的上游模型名，并把渠道白名单收窄到该成员的单一渠道 —— 使后续 getChannel 的池选择
// 精确落到这个成员(渠道+模型)。非模型组路由(context 无成员列表)时是 no-op。
func advanceModelGroupMemberForAttempt(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam) {
	members, ok := common.GetContextKeyType[[]model.ModelGroupMember](c, constant.ContextKeyModelGroupMembers)
	if !ok || len(members) == 0 {
		return // 非模型组路由
	}
	member, idx := model.PickModelGroupMember(members, excludedChannelSet(c))
	if idx < 0 {
		return
	}
	common.SetContextKey(c, constant.ContextKeyModelGroupMemberIndex, idx)

	// 改写为该成员的上游模型名：请求体 + relayInfo + retryParam 三处保持一致，
	// 因为 relay handler 会从请求体重新解析、也会用 OriginModelName 重置出站模型。
	if storage, err := common.GetBodyStorage(c); err == nil {
		if body, bErr := storage.Bytes(); bErr == nil && len(body) > 0 {
			if newBody, sErr := sjson.SetBytes(body, "model", member.ModelName); sErr == nil {
				_ = common.OverwriteRequestBody(c, newBody)
			}
		}
	}
	info.OriginModelName = member.ModelName
	if info.Request != nil {
		info.Request.SetModelName(member.ModelName)
	}
	retryParam.ModelName = member.ModelName
	// 收窄到该成员单一渠道：与池按模型名求交后精确锁定这个 (渠道,模型)。
	retryParam.AllowedChannelIds = map[int]bool{member.ChannelId: true}
}

// excludedChannelSet returns the set of channel ids ABANDONED on this request
// (keys exhausted or a channel-scoped failure). Selection and model-group member
// advance skip these. It reads abandoned_channel, NOT use_channel, so a channel
// that is merely being key-rotated (still in use_channel) remains selectable.
func excludedChannelSet(c *gin.Context) map[int]bool {
	abandoned := c.GetStringSlice("abandoned_channel")
	if len(abandoned) == 0 {
		return nil
	}
	set := make(map[int]bool, len(abandoned))
	for _, s := range abandoned {
		if id, err := strconv.Atoi(s); err == nil {
			set[id] = true
		}
	}
	return set
}

func fastTokenCountMetaForPricing(request dto.Request) *types.TokenCountMeta {
	if request == nil {
		return &types.TokenCountMeta{}
	}
	meta := &types.TokenCountMeta{
		TokenType: types.TokenTypeTokenizer,
	}
	switch r := request.(type) {
	case *dto.GeneralOpenAIRequest:
		maxCompletionTokens := lo.FromPtrOr(r.MaxCompletionTokens, uint(0))
		maxTokens := lo.FromPtrOr(r.MaxTokens, uint(0))
		if maxCompletionTokens > maxTokens {
			meta.MaxTokens = int(maxCompletionTokens)
		} else {
			meta.MaxTokens = int(maxTokens)
		}
	case *dto.OpenAIResponsesRequest:
		meta.MaxTokens = int(lo.FromPtrOr(r.MaxOutputTokens, uint(0)))
	case *dto.ClaudeRequest:
		meta.MaxTokens = int(lo.FromPtr(r.MaxTokens))
	case *dto.ImageRequest:
		// Pricing for image requests depends on ImagePriceRatio; safe to compute even when CountToken is disabled.
		return r.GetTokenCountMeta()
	default:
		// Best-effort: leave CombineText empty to avoid large allocations.
	}
	return meta
}

// getChannel selects the channel + key for one attempt. When sticky is non-nil,
// it re-uses that exact channel (single-request key rotation) instead of picking
// a fresh one from the pool, so another of the SAME channel's keys is tried.
func getChannel(c *gin.Context, info *relaycommon.RelayInfo, retryParam *service.RetryParam, sticky *model.Channel) (*model.Channel, *types.NewAPIError) {
	if info.ChannelMeta == nil {
		autoBan := c.GetBool("auto_ban")
		autoBanInt := 1
		if !autoBan {
			autoBanInt = 0
		}
		return &model.Channel{
			Id:      c.GetInt("channel_id"),
			Type:    c.GetInt("channel_type"),
			Name:    c.GetString("channel_name"),
			AutoBan: &autoBanInt,
		}, nil
	}

	var channel *model.Channel
	if sticky != nil {
		// Key rotation: same channel, next untried key. Group ratio is unchanged.
		channel = sticky
		info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
	} else {
		var selectGroup string
		var err error
		channel, selectGroup, err = service.CacheGetRandomSatisfiedChannel(retryParam)

		info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)

		if err != nil {
			return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, info.OriginModelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
		}
		if channel == nil {
			return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, info.OriginModelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
		}
	}

	// Pass the keys already tried on THIS channel this request so single-request
	// key rotation skips them. nil on fresh channels (nothing tried yet).
	newAPIError := middleware.SetupContextForSelectedChannelExcluding(c, channel, info.OriginModelName, retryParam.TriedKeysFor(channel.Id))
	if newAPIError != nil {
		return nil, newAPIError
	}
	return channel, nil
}

func shouldRetry(c *gin.Context, openaiErr *types.NewAPIError, retryTimes int) bool {
	if openaiErr == nil {
		return false
	}
	if service.ShouldSkipRetryAfterChannelAffinityFailure(c) {
		return false
	}
	if types.IsChannelError(openaiErr) {
		return true
	}
	if types.IsSkipRetryError(openaiErr) {
		return false
	}
	if retryTimes <= 0 {
		return false
	}
	if _, ok := c.Get("specific_channel_id"); ok {
		return false
	}
	code := openaiErr.StatusCode
	if code >= 200 && code < 300 {
		return false
	}
	if code < 100 || code > 599 {
		return true
	}
	if operation_setting.IsAlwaysSkipRetryCode(openaiErr.GetErrorCode()) {
		return false
	}
	return operation_setting.ShouldRetryByStatusCode(code)
}

// breakerKeyIndex returns the multi-key index used for this request for the
// routehealth breaker: the actual key index for multi-key channels, or -1 to
// address the channel itself for single-key channels.
func breakerKeyIndex(c *gin.Context, isMultiKey bool) int {
	if isMultiKey {
		return common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
	}
	return -1
}

func processChannelError(c *gin.Context, channelError types.ChannelError, err *types.NewAPIError) {
	logger.LogError(c, fmt.Sprintf("channel error (channel #%d, status code: %d): %s", channelError.ChannelId, err.StatusCode, common.LocalLogPreview(err.Error())))
	// Record the transient failure for the routehealth circuit breaker (429/5xx
	// cool the channel/key down and recover on their own; other codes are ignored
	// by the breaker's trip-code filter). Runs synchronously here — safe to read
	// the request context.
	routehealth.RecordFailure(channelError.ChannelId, breakerKeyIndex(c, channelError.IsMultiKey), err.StatusCode)
	// 不要使用context获取渠道信息，异步处理时可能会出现渠道信息不一致的情况
	// do not use context to get channel info, there may be inconsistent channel info when processing asynchronously
	if service.ShouldDisableChannel(err) && channelError.AutoBan {
		gopool.Go(func() {
			service.DisableChannel(channelError, err.ErrorWithStatusCode())
		})
	}

	if constant.ErrorLogEnabled && types.IsRecordErrorLog(err) {
		// 保存错误日志到mysql中
		userId := c.GetInt("id")
		tokenName := c.GetString("token_name")
		modelName := c.GetString("original_model")
		tokenId := c.GetInt("token_id")
		userGroup := c.GetString("group")
		channelId := c.GetInt("channel_id")
		other := make(map[string]interface{})
		if c.Request != nil && c.Request.URL != nil {
			other["request_path"] = c.Request.URL.Path
		}
		other["error_type"] = err.GetErrorType()
		other["error_code"] = err.GetErrorCode()
		other["status_code"] = err.StatusCode
		other["channel_id"] = channelId
		other["channel_name"] = c.GetString("channel_name")
		other["channel_type"] = c.GetInt("channel_type")
		adminInfo := make(map[string]interface{})
		adminInfo["use_channel"] = c.GetStringSlice("use_channel")
		isMultiKey := common.GetContextKeyBool(c, constant.ContextKeyChannelIsMultiKey)
		if isMultiKey {
			adminInfo["is_multi_key"] = true
			adminInfo["multi_key_index"] = common.GetContextKeyInt(c, constant.ContextKeyChannelMultiKeyIndex)
		}
		service.AppendChannelAffinityAdminInfo(c, adminInfo)
		other["admin_info"] = adminInfo
		startTime := common.GetContextKeyTime(c, constant.ContextKeyRequestStartTime)
		if startTime.IsZero() {
			startTime = time.Now()
		}
		useTimeSeconds := int(time.Since(startTime).Seconds())
		model.RecordErrorLog(c, userId, channelId, modelName, tokenName, err.MaskSensitiveErrorWithStatusCode(), tokenId, useTimeSeconds, common.GetContextKeyBool(c, constant.ContextKeyIsStream), userGroup, other)
	}

}

func RelayNotImplemented(c *gin.Context) {
	err := types.OpenAIError{
		Message: "API not implemented",
		Type:    "tierflow_error",
		Param:   "",
		Code:    "api_not_implemented",
	}
	c.JSON(http.StatusNotImplemented, gin.H{
		"error": err,
	})
}

func RelayNotFound(c *gin.Context) {
	err := types.OpenAIError{
		Message: fmt.Sprintf("Invalid URL (%s %s)", c.Request.Method, c.Request.URL.Path),
		Type:    "invalid_request_error",
		Param:   "",
		Code:    "",
	}
	c.JSON(http.StatusNotFound, gin.H{
		"error": err,
	})
}
