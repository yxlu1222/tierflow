package middleware

import (
	"net/http"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/types"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

// 套餐额度门禁(P4,docs/subscription-gap-analysis.md §3.4):
// 仅对「套餐专用 Key + 智能路由别名」的请求生效,在 AutoRoute 选出档位模型后、
// 模型组解析前介入:
//
//  1. 长上下文兜底:估算上下文超过基础模型上限(含缓冲带)时,高级桶有余额则
//     强制切到高级套餐模型组;高级桶已空则按产品文案拒绝。
//  2. 额度降级:选中的模型属于高级桶但高级桶已耗尽时,降级到基础套餐模型组;
//     基础桶也不可用则放行,由计费层以 insufficient_subscription_quota 拒绝
//     (「用量达到套餐上限,已失效」语义)。
//
// realtime/WebSocket 端点不经 AutoRoute,套餐规则不覆盖(D11)。

// 基础模型上下文上限(token)与切换缓冲带。可用环境变量覆盖:
//
//	BASIC_MODEL_CONTEXT_TOKENS  (默认 256000)
//	BASIC_MODEL_CONTEXT_SWITCH  (默认 240000,>该值即切高级,留估算误差缓冲)
var (
	basicContextLimitTokens  = common.GetEnvOrDefault("BASIC_MODEL_CONTEXT_TOKENS", 256000)
	basicContextSwitchTokens = common.GetEnvOrDefault("BASIC_MODEL_CONTEXT_SWITCH", 240000)
)

// tokensPerAttachment 单个非文本 part(图片/附件/音频)计入的固定 token 量。
// 高清图约 1-2k token,取 1500 作中值;可用 SUBSCRIPTION_GATE_ATTACHMENT_TOKENS 覆盖。
var tokensPerAttachment = common.GetEnvOrDefault("SUBSCRIPTION_GATE_ATTACHMENT_TOKENS", 1500)

// estimateContextTokens 估算上下文 token 量:文本部分按 bytes/3,
// 非文本 part 按固定单价计,而不是按其 base64 字节数计。
//
// 依据:CJK 约 3B/token,英文约 4B/token(会高估 ~33%,方向安全)。
// 但 base64 附件不能一起按 bytes/3 算——1MB 的图片会被算成 35 万 token,
// 直接把请求顶过 240k 阈值,于是要么被强切到高级桶多计费,要么被
// 「高级模型额度用完了」直接拒掉,而它其实是个短对话加一张图。
//
// 中间件阶段拿不到真实 token 估算(relayInfo.SetEstimatePromptTokens 在 relay
// 管线里才调用),故仍用字节近似,只是把附件负载从字节数里剔除。
func estimateContextTokens(body []byte) int {
	payloadBytes, attachments := nonTextPayloadStats(body)
	textBytes := len(body) - payloadBytes
	if textBytes < 0 {
		textBytes = 0
	}
	return textBytes/3 + attachments*tokensPerAttachment
}

// attachmentPayloadFields 各类非文本 part 承载 base64/URL 负载的字段名。
var attachmentPayloadFields = []string{
	"image_url.url", "image_url", // {type:image_url, image_url:{url}} 与 input_image 的扁平写法
	"file.file_data", "file_data",
	"input_audio.data", "data",
	"video_url.url",
}

// nonTextPayloadStats 统计请求体里非文本 part 的负载字节数与个数。
// 兼容 chat(messages[*].content[*])与 Responses(input[*].content[*])两种结构。
func nonTextPayloadStats(body []byte) (payloadBytes int, attachments int) {
	for _, root := range []string{"messages", "input"} {
		arr := gjson.GetBytes(body, root)
		if !arr.IsArray() {
			continue
		}
		arr.ForEach(func(_, msg gjson.Result) bool {
			content := msg.Get("content")
			if !content.IsArray() {
				return true // 字符串 content 一定是纯文本
			}
			content.ForEach(func(_, part gjson.Result) bool {
				switch part.Get("type").String() {
				case "image_url", "input_image",
					"input_audio", "audio",
					"file", "input_file",
					"video_url", "input_video":
					attachments++
					for _, field := range attachmentPayloadFields {
						if v := part.Get(field); v.Exists() && v.Type == gjson.String {
							payloadBytes += len(v.String())
							break
						}
					}
				}
				return true
			})
			return true
		})
	}
	return payloadBytes, attachments
}

// abortWithRelayFormatMessage 按端点格式输出错误体:/v1/messages(Claude 格式)
// 输出 Anthropic 风格 error,其余走 OpenAI 风格。修复中间件层报错只有
// OpenAI 格式的问题(relay 层的三格式序列化在中间件不可达)。
func abortWithRelayFormatMessage(c *gin.Context, statusCode int, message string, code types.ErrorCode) {
	if strings.Contains(c.Request.URL.Path, "/messages") {
		c.JSON(statusCode, gin.H{
			"type": "error",
			"error": gin.H{
				"type":    "invalid_request_error",
				"message": common.MessageWithRequestId(message, c.GetString(common.RequestIdKey)),
			},
		})
		c.Abort()
		return
	}
	abortWithOpenAiMessage(c, statusCode, message, code)
}

// subscriptionGateResult 门禁产物:改写后的档位值(可能是 mg:<id>)与观测信息。
type subscriptionGateResult struct {
	tierValue     string // 门禁后的档位值(原样 / mg:<premium> / mg:<basic>)
	bucket        model.SubscriptionBucket
	degradeReason string // "premium_exhausted" / "" ;长上下文强切记 "long_context"
	aborted       bool
	// resolved 表示 bucket 是真判出来的,而非提前返回时的结构体默认值(premium)。
	// 只有 resolved 时才把它作为权威结果交给计费层——否则一次计划/余额读取失败
	// 就会让基础模型请求按高级桶扣费,把「保守默认」变成对用户的多收费。
	resolved bool
}

// applySubscriptionGate 对套餐 Key 请求执行长上下文兜底与额度降级。
// tierValue 是 ResolveModel 产物(具体模型名或 mg:<id>)。aborted=true 时已写响应。
func applySubscriptionGate(c *gin.Context, subscriptionId int, tierValue string, body []byte) subscriptionGateResult {
	res := subscriptionGateResult{tierValue: tierValue, bucket: model.BucketPremium}

	// 套餐与计划:全程缓存读
	info, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(subscriptionId)
	if err != nil || info == nil || info.PlanId <= 0 {
		return res // 拿不到计划 → 不干预(计费层兜底)
	}
	plan, err := model.GetSubscriptionPlanById(info.PlanId)
	if err != nil || plan == nil {
		return res
	}

	balances, err := model.GetSubscriptionBucketBalances(subscriptionId)
	if err != nil {
		return res
	}

	// 当前档位值属于哪个桶
	if groupId, isRef := model.ParseModelGroupRef(tierValue); isRef {
		res.bucket = model.ResolveModelBucket(plan, groupId, "")
	} else {
		res.bucket = model.ResolveModelBucket(plan, 0, tierValue)
	}
	res.resolved = true

	// ---- 1) 长上下文兜底 ----
	if estimateContextTokens(body) > basicContextSwitchTokens {
		if balances.PremiumAvailable() {
			if res.bucket != model.BucketPremium {
				if gid, ok := model.PickSetModelGroup(plan.PremiumSetId); ok {
					res.tierValue = model.FormatModelGroupRef(gid)
					res.bucket = model.BucketPremium
					res.degradeReason = "long_context"
				}
				// premium set 未配置 → 保持原样(尽力而为)
			}
			return res
		}
		// 高级桶已空且上下文超基础模型承载 → 按产品文案拒绝
		abortWithRelayFormatMessage(c, http.StatusForbidden,
			"高级模型额度用完了,超出基础模型上下文,请重开窗口",
			types.ErrorCodeInsufficientSubscriptionQuota)
		res.aborted = true
		return res
	}

	// ---- 2) 高级桶耗尽 → 降级基础 ----
	if res.bucket == model.BucketPremium && !balances.PremiumAvailable() {
		if balances.BasicAvailable() {
			if gid, ok := model.PickSetModelGroup(plan.BasicSetId); ok {
				res.tierValue = model.FormatModelGroupRef(gid)
				res.bucket = model.BucketBasic
				res.degradeReason = "premium_exhausted"
				return res
			}
		}
		// 基础桶不可用/未配置 → 放行,由计费层报「用量达到套餐上限」
	}
	return res
}
