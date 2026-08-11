package middleware

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

const maxRoutingContentChars = 4096

// AutoRoute —— TierFlow 智能路由中间件。
//
// 当请求的 model 命中某个启用的 RoutingProfile 别名（如 "auto"）时：
//  1. 从 messages 抽取路由切片（末轮 user + 其后 assistant/tool 尾窗，含 tool_calls）；
//  2. 调 tierflow-infer 打分（0-10）；
//  3. 按 profile.ScoreBands 把分数映射到 tier，取对应具体模型；
//  4. 用 sjson 改写请求体的 "model" 字段并替换 body。
//
// 改写发生在 Distribute 之前，因此后续渠道选择 / 计费 / 上游转发全程看到的都是
// 真实模型名，无需改动 new-api 既有管线。未命中别名则原样透传。
func AutoRoute() func(c *gin.Context) {
	return func(c *gin.Context) {
		// 仅处理 JSON 聊天类请求体
		if !strings.HasPrefix(c.Request.Header.Get("Content-Type"), "application/json") {
			c.Next()
			return
		}
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			c.Next()
			return
		}
		body, err := storage.Bytes()
		if err != nil {
			c.Next()
			return
		}

		requestedModel := gjson.GetBytes(body, "model").String()
		if requestedModel == "" {
			c.Next()
			return
		}
		profile := model.GetRoutingProfileByAlias(requestedModel)
		if profile == nil {
			// 非智能路由别名 = 点名真实模型。
			// 受限模式下（非管理员）禁止直调上游，强制走路由别名；管理员豁免，便于直连测试。
			if model.ShouldRestrictDirectModelCall() && !model.IsAdmin(c.GetInt("id")) {
				abortWithOpenAiMessage(c, http.StatusForbidden, "请使用路由模型名称")
				return
			}
			// 普通模型，原样走 new-api 既有流程
			c.Next()
			return
		}

		requestId := c.GetString(common.RequestIdKey)

		// 路由决策耗时计时：主要成本是下面的 infer 打分往返，多模态/兜底分支近乎 0。
		routeStart := time.Now()

		var concreteModel string
		var tier int
		var score float64
		var scored bool
		var multimodal bool

		// 多模态兜底：请求含图片/音频等非文本内容时，若 profile 配了多模态模型，直接路由过去，
		// 跳过打分（纯文本打分对多模态无意义，且避免落到不支持多模态的模型导致上游 400）。
		if profile.MultimodalModel != "" && requestHasMultimodalContent(body) {
			concreteModel = profile.MultimodalModel
			multimodal = true
		} else if s, ok := service.ClassifyDifficulty(extractRoutingSlices(body), profile.Slug, requestId); ok {
			score = s
			scored = true
			concreteModel, tier = profile.ResolveModel(s)
			c.Set("auto_route_score", s)
		} else {
			// 打分失败 / 无消息 / 熔断 —— 兜底默认档（tier3），避免分类器故障拖垮路由。
			// 降级标记只随日志 other 落盘、仅管理端展示，不向用户暴露。
			concreteModel, tier = profile.DefaultModel()
			c.Set("auto_route_degraded", true)
		}
		if concreteModel == "" {
			// profile 未配置任何 tier 模型 —— 透传（后续大概率渠道选择失败并报错）
			common.SysError("routing profile '" + profile.Slug + "' has no tier model configured")
			c.Next()
			return
		}

		// 套餐额度门禁:套餐专用 Key 的长上下文兜底与高级桶降级(subscription_gate.go)。
		// 放在档位解析之后、模型组解析之前——门禁可能把档位改写成 mg:<set 内组>,
		// 复用下方既有的模型组解析与渠道白名单链路。
		gateBucket := ""
		gateDegrade := ""
		if subId := common.GetContextKeyInt(c, constant.ContextKeyTokenSubscriptionId); subId > 0 {
			gate := applySubscriptionGate(c, subId, concreteModel, body)
			if gate.aborted {
				return
			}
			concreteModel = gate.tierValue
			gateBucket = string(gate.bucket)
			gateDegrade = gate.degradeReason
			// 把门禁判定的桶传给计费层。门禁按模型组 id 精确判定,且降级时主动换了组;
			// 计费层若再按最终模型名反查一遍,两条路径可能分叉——被门禁降级到基础组的
			// 请求会被算回已耗尽的高级桶,然后以「额度已用完」拒掉一个门禁刚特意保下来的请求。
			// 未真正判出桶(计划/余额读取失败)时不写,让计费层照旧按模型名反查。
			if gate.resolved {
				common.SetContextKey(c, constant.ContextKeySubscriptionBucket, gateBucket)
			}
		}

		// 模型组解析(G2)：若档位指向模型组(mg:<id>)，解析为有序成员(按优先级)，选首个可用成员，
		// 改写为该成员的上游模型名，并把成员列表 / 当前下标 / 渠道白名单写入 context —— 供
		// relay 重试循环在组成员内做故障转移(每次尝试钉一个成员=渠道+模型名)。
		// 异构成员：各成员上游模型名可不同，故必须逐成员改写模型 + 约束渠道。
		if groupId, isRef := model.ParseModelGroupRef(concreteModel); isRef {
			members := model.GetOrderedModelGroupMembers(groupId)
			member, idx := model.PickModelGroupMember(members, nil)
			if idx < 0 {
				common.SysError("routing profile '" + profile.Slug + "' tier references empty/invalid model group " + concreteModel)
				c.Next()
				return
			}
			concreteModel = member.ModelName
			common.SetContextKey(c, constant.ContextKeyModelGroupMembers, members)
			common.SetContextKey(c, constant.ContextKeyModelGroupMemberIndex, idx)
			common.SetContextKey(c, constant.ContextKeyAllowedChannelIds, model.AllowedChannelIdsFromMembers(members))
			// 组身份快照：看板按"命中 tier 对应的模型组"聚合展示的数据源头。
			// 存名字快照而非仅 id——日志是事实记录，记"当时它叫什么"。
			c.Set("auto_route_group_id", groupId)
			c.Set("auto_route_group", model.GetModelGroupNameById(groupId))
		}
		// 注意:档位直配具体模型 / 多模态兜底 / 降级默认档时【刻意不落】
		// auto_route_group —— model_group 列对普通用户可见(用量看板/日志回落
		// 展示),写入真实上游模型名会打破「上游对用户彻底抽象」的承诺。这类
		// 流量在管理端组维度只能回落显示方案别名;真实上游仍可经
		// logs.other.auto_route_upstream(仅管理端)追溯。

		newBody, err := sjson.SetBytes(body, "model", concreteModel)
		if err != nil {
			c.Next()
			return
		}
		if err := common.OverwriteRequestBody(c, newBody); err != nil {
			common.SysError("auto route failed to overwrite request body: " + err.Error())
			c.Next()
			return
		}

		// 路由元信息，供日志/调试
		c.Set("auto_route_alias", requestedModel)
		c.Set("auto_route_profile", profile.Slug)
		c.Set("auto_route_tier", tier)
		if multimodal {
			c.Set("auto_route_multimodal", true)
		}

		// 记录路由决策，供实时路由监控
		service.RecordRouteDecision(service.RouteDecision{
			Time:      common.GetTimestamp(),
			RequestId: requestId,
			Alias:     requestedModel,
			Profile:   profile.Slug,
			Scored:    scored,
			Score:     score,
			Tier:      tier,
			Model:     concreteModel,
			RouteMs:   time.Since(routeStart).Milliseconds(),
			UserId:    c.GetInt("id"),
			TokenName: c.GetString("token_name"),
			Bucket:    gateBucket,
			Degrade:   gateDegrade,
		})
		c.Next()
	}
}

// RestrictDirectModelCallWS 给非 JSON-body 的 relay 端点（如 realtime websocket）补上
// "仅路由别名" 访问控制。AutoRoute 只作用于 JSON body 端点（model 在请求体里），而 realtime
// 的 model 在 query 上（?model=...），AutoRoute 取不到，故单独加这道闸，语义与 AutoRoute 一致：
// 受限模式下非管理员只能用路由别名，点名真实上游模型一律拒。
func RestrictDirectModelCallWS() func(c *gin.Context) {
	return func(c *gin.Context) {
		requested := c.Query("model")
		// 空模型交给后续 Distribute 报错；是路由别名则放行（realtime 下游多半不支持，会自然失败）。
		if requested == "" || model.GetRoutingProfileByAlias(requested) != nil {
			c.Next()
			return
		}
		if model.ShouldRestrictDirectModelCall() && !model.IsAdmin(c.GetInt("id")) {
			abortWithOpenAiMessage(c, http.StatusForbidden, "请使用路由模型名称")
			return
		}
		c.Next()
	}
}

// 路由切片尾窗大小与 tool_calls 参数截断上限。
// 尾窗 8 条 ≈ 最近 2-4 轮 assistant/tool 交互，足够 infer 侧拼出
// [Previous Input]/[Previous Output]/[Previous Tool Calls]/[Previous Tool Results]。
const (
	maxRoutingTailMessages  = 8
	maxRoutingToolArgsChars = 1000
)

// extractRoutingSlices 从 messages 抽取用于难度打分的切片，结构与
// tierflow-infer v4 build_routing_input(app/utils/input_builder.py) 的消费方式对齐：
//
//	U*   = 最后一条 user 消息（当前任务，infer 侧作 [Original Task]）
//	尾窗 = U* 之后的 assistant/tool 消息，取最后 maxRoutingTailMessages 条；
//	       assistant 保留 tool_calls（参数截断），tool 保留 name —— infer 侧靠它们
//	       拼 [Previous Tool Calls]/[Previous Tool Results]，tool 必须排在所属 assistant 之后
//
// 注意不能再发瘦身后的 [U*, P(tool), A*]：assistant 内容为空的 agent 工具循环里
// 那种切片会退化成只剩 [Original Task] 的常量输入，整个会话打分恒定（曾致全程 0 分、
// 一律路由到最低档）。窗口开头的孤儿 tool（所属 assistant 不在窗口内）infer 侧用不上，裁掉。
// requestHasMultimodalContent 检测请求体里是否含非文本内容（图片/音频/文件/视频）。
// 兼容 chat（messages[*].content[*]）与 Responses（input[*].content[*]）两种结构：
// content 为字符串时一定是纯文本；为 part 数组时,出现任一非 text part 即判定为多模态。
func requestHasMultimodalContent(body []byte) bool {
	return hasNonTextContentPart(gjson.GetBytes(body, "messages")) ||
		hasNonTextContentPart(gjson.GetBytes(body, "input"))
}

func hasNonTextContentPart(arr gjson.Result) bool {
	if !arr.IsArray() {
		return false
	}
	found := false
	arr.ForEach(func(_, msg gjson.Result) bool {
		content := msg.Get("content")
		if !content.IsArray() {
			return true // 跳过字符串/缺省 content
		}
		content.ForEach(func(_, part gjson.Result) bool {
			switch part.Get("type").String() {
			case "image_url", "input_image",
				"input_audio", "audio",
				"file", "input_file",
				"video_url", "input_video":
				found = true
				return false // 命中,停内层
			}
			return true
		})
		return !found // 命中后停外层
	})
	return found
}

func extractRoutingSlices(body []byte) []map[string]any {
	if msgs := gjson.GetBytes(body, "messages"); msgs.IsArray() && len(msgs.Array()) > 0 {
		return extractRoutingSlicesFromMessages(msgs.Array())
	}
	// OpenAI Responses API（/v1/responses，Codex 经 tierflow-codex 别名走的就是它）把会话放在
	// `input` 而非 `messages`。缺少这条兜底时，所有 responses 请求都打分失败、静默落到默认档，
	// 一旦默认档的模型/渠道不支持 Responses API，上游就回 404（"bad response status code 404"），
	// 而同一别名在 /v1/chat/completions 上却正常 —— 这正是"有时 /v1/responses 404"的根因。
	if input := gjson.GetBytes(body, "input"); input.Exists() {
		return extractRoutingSlicesFromInput(input)
	}
	return nil
}

// extractRoutingSlicesFromMessages 处理 chat/completions 与 claude 格式的 `messages` 数组。
func extractRoutingSlicesFromMessages(arr []gjson.Result) []map[string]any {
	n := len(arr)
	roleOf := func(i int) string { return arr[i].Get("role").String() }

	lastUser := -1
	for i := 0; i < n; i++ {
		if roleOf(i) == "user" {
			lastUser = i
		}
	}
	if lastUser < 0 {
		return nil
	}

	out := []map[string]any{{
		"role":    "user",
		"content": contentToString(arr[lastUser].Get("content")),
	}}

	var tail []int
	for i := lastUser + 1; i < n; i++ {
		if r := roleOf(i); r == "assistant" || r == "tool" {
			tail = append(tail, i)
		}
	}
	if len(tail) > maxRoutingTailMessages {
		tail = tail[len(tail)-maxRoutingTailMessages:]
	}
	for len(tail) > 0 && roleOf(tail[0]) == "tool" {
		tail = tail[1:]
	}
	for _, i := range tail {
		out = append(out, routingTailMsg(arr[i]))
	}
	return out
}

// inputNormMsg 是 Responses API `input` 条目归一化后的中间形态，结构对齐
// extractRoutingSlicesFromMessages 的输出（role/content/tool_calls/name）。
type inputNormMsg struct {
	role      string
	content   string
	toolCalls []map[string]any
	name      string
}

// extractRoutingSlicesFromInput 处理 OpenAI Responses API 的 `input` 字段，产出与
// messages 路径一致的路由切片（末轮 user + 其后 assistant/tool 尾窗，含 tool_calls）。
//
// `input` 可能是：
//   - 纯字符串：当作单条 user 消息；
//   - 数组：每个条目可能是 message(role+content)、function_call(工具调用)、
//     function_call_output(工具结果)，或 reasoning 等（路由用不上，跳过）。
//
// content 可能是字符串或多模态 part 数组（input_text/output_text 带 text），统一抽成文本。
func extractRoutingSlicesFromInput(input gjson.Result) []map[string]any {
	if input.Type == gjson.String {
		s := truncateRoutingText(input.String(), maxRoutingContentChars)
		if s == "" {
			return nil
		}
		return []map[string]any{{"role": "user", "content": s}}
	}
	if !input.IsArray() {
		return nil
	}

	items := input.Array()
	msgs := make([]inputNormMsg, 0, len(items))
	for _, it := range items {
		role := it.Get("role").String()
		switch it.Get("type").String() {
		case "function_call":
			msgs = append(msgs, inputNormMsg{
				role: "assistant",
				toolCalls: []map[string]any{{
					"id":   it.Get("call_id").String(),
					"type": "function",
					"function": map[string]any{
						"name":      it.Get("name").String(),
						"arguments": truncateRoutingText(it.Get("arguments").String(), maxRoutingToolArgsChars),
					},
				}},
			})
		case "function_call_output":
			msgs = append(msgs, inputNormMsg{
				role:    "tool",
				content: truncateRoutingText(responsesContentToString(it.Get("output")), maxRoutingContentChars),
				name:    it.Get("name").String(),
			})
		default:
			// type 省略或为 "message" 时靠 role 区分；reasoning/无 role 的条目跳过。
			if role == "" {
				continue
			}
			msgs = append(msgs, inputNormMsg{
				role:    role,
				content: truncateRoutingText(responsesContentToString(it.Get("content")), maxRoutingContentChars),
			})
		}
	}

	lastUser := -1
	for i := range msgs {
		if msgs[i].role == "user" {
			lastUser = i
		}
	}
	if lastUser < 0 {
		return nil
	}

	out := []map[string]any{{
		"role":    "user",
		"content": msgs[lastUser].content,
	}}

	var tail []inputNormMsg
	for i := lastUser + 1; i < len(msgs); i++ {
		if r := msgs[i].role; r == "assistant" || r == "tool" {
			tail = append(tail, msgs[i])
		}
	}
	if len(tail) > maxRoutingTailMessages {
		tail = tail[len(tail)-maxRoutingTailMessages:]
	}
	for len(tail) > 0 && tail[0].role == "tool" {
		tail = tail[1:]
	}
	for _, m := range tail {
		mm := map[string]any{
			"role":    m.role,
			"content": m.content,
		}
		if m.role == "assistant" && len(m.toolCalls) > 0 {
			mm["tool_calls"] = m.toolCalls
		}
		if m.role == "tool" && m.name != "" {
			mm["name"] = m.name
		}
		out = append(out, mm)
	}
	return out
}

// responsesContentToString 把 Responses API 的 content/output 归一化为文本：
// 字符串直接用；part 数组(input_text/output_text 等)取各 part 的 text 拼接；其余取原始 JSON。
func responsesContentToString(content gjson.Result) string {
	if !content.Exists() {
		return ""
	}
	if content.Type == gjson.String {
		return content.String()
	}
	if content.IsArray() {
		var b strings.Builder
		for _, part := range content.Array() {
			t := part.Get("text")
			if !t.Exists() {
				continue
			}
			if b.Len() > 0 {
				b.WriteByte('\n')
			}
			b.WriteString(t.String())
		}
		if b.Len() > 0 {
			return b.String()
		}
	}
	return content.Raw
}

// routingTailMsg 构造尾窗消息：assistant 带 tool_calls(参数截断)，tool 带 name。
func routingTailMsg(m gjson.Result) map[string]any {
	role := m.Get("role").String()
	out := map[string]any{
		"role":    role,
		"content": contentToString(m.Get("content")),
	}
	switch role {
	case "assistant":
		toolCalls := m.Get("tool_calls")
		if !toolCalls.IsArray() {
			break
		}
		calls := make([]map[string]any, 0, len(toolCalls.Array()))
		for _, tc := range toolCalls.Array() {
			calls = append(calls, map[string]any{
				"id":   tc.Get("id").String(),
				"type": "function",
				"function": map[string]any{
					"name":      tc.Get("function.name").String(),
					"arguments": truncateRoutingText(tc.Get("function.arguments").String(), maxRoutingToolArgsChars),
				},
			})
		}
		if len(calls) > 0 {
			out["tool_calls"] = calls
		}
	case "tool":
		if name := m.Get("name").String(); name != "" {
			out["name"] = name
		}
	}
	return out
}

// contentToString 把消息 content 归一化为字符串（多模态/数组取原始 JSON），并按字符上限截断。
func contentToString(content gjson.Result) string {
	if !content.Exists() {
		return ""
	}
	var s string
	if content.Type == gjson.String {
		s = content.String()
	} else {
		s = content.Raw
	}
	return truncateRoutingText(s, maxRoutingContentChars)
}

// truncateRoutingText 按字符上限截断，并退到合法的 UTF-8 边界，避免截断多字节字符。
func truncateRoutingText(s string, max int) string {
	if len(s) <= max {
		return s
	}
	s = s[:max]
	for len(s) > 0 && !utf8.ValidString(s) {
		s = s[:len(s)-1]
	}
	return s
}
