package service

import (
	"encoding/json"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/types"
)

// ── 请求侧：抽出 messages ────────────────────────────────────────────────

type rawMessage struct {
	Role       string          `json:"role"`
	Content    json.RawMessage `json:"content"`
	ToolCalls  json.RawMessage `json:"tool_calls"`
	ToolCallId string          `json:"tool_call_id"`
}

type openAIRequest struct {
	Messages []rawMessage `json:"messages"`
}

type claudeRequest struct {
	System   json.RawMessage `json:"system"`
	Messages []rawMessage    `json:"messages"`
}

// contentPart 覆盖 OpenAI 与 Claude 两家的 content 数组元素。
// 两家的文本项都是 {"type":"text","text":"..."}，差异在多媒体与工具项。
type contentPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
	// Claude 扩展思考块
	Thinking string `json:"thinking"`
	// Claude tool_result
	ToolUseId string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	// Claude tool_use
	Id    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

// extractText 把一个 content 字段解成纯文本，并返回被剥离的媒体块数量。
//
// content 可能是字符串，也可能是分块数组。图片/音频块**只计数不留占位符**
// —— 设计要求"仅记录原始文本"。
func extractText(raw json.RawMessage) (text string, media int) {
	if len(raw) == 0 {
		return "", 0
	}
	// 形态一：纯字符串
	var s string
	if err := common.Unmarshal(raw, &s); err == nil {
		return s, 0
	}
	// 形态二：分块数组
	var parts []contentPart
	if err := common.Unmarshal(raw, &parts); err != nil {
		return "", 0
	}
	var sb strings.Builder
	for _, p := range parts {
		switch p.Type {
		case "text":
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(p.Text)
		case "image_url", "image", "input_audio", "audio", "inline_data", "file_data", "document":
			media++
		}
	}
	return sb.String(), media
}

// parseRequestMessages 按 relay format 从请求体里抽出消息序列。
func parseRequestMessages(relayFormat string, body []byte) []parsedMessage {
	switch relayFormat {
	case string(types.RelayFormatClaude):
		return parseClaudeRequest(body)
	case string(types.RelayFormatOpenAI):
		return parseOpenAIRequest(body)
	default:
		// Gemini / Responses 走到这里。两者的请求结构与上面两家差别较大，
		// 先按 OpenAI 尝试(部分兼容路径确实是 OpenAI 结构)，解不出就返回空。
		// TODO: 补 Gemini contents[] 与 Responses input[] 的原生解析。
		return parseOpenAIRequest(body)
	}
}

func parseOpenAIRequest(body []byte) []parsedMessage {
	var req openAIRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil
	}
	out := make([]parsedMessage, 0, len(req.Messages))
	for _, m := range req.Messages {
		text, media := extractText(m.Content)
		pm := parsedMessage{
			Role:   normalizeRole(m.Role),
			Text:   text,
			Media:  media,
			ToolId: m.ToolCallId,
		}
		if len(m.ToolCalls) > 0 && string(m.ToolCalls) != "null" {
			pm.ToolCalls = string(m.ToolCalls)
		}
		// 剥离后无文本、也无工具信息的消息(纯图片)整条跳过，不落盘不计数
		if pm.Text == "" && pm.ToolCalls == "" && pm.ToolId == "" {
			continue
		}
		out = append(out, pm)
	}
	return out
}

func parseClaudeRequest(body []byte) []parsedMessage {
	var req claudeRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil
	}
	out := make([]parsedMessage, 0, len(req.Messages)+1)

	// Claude 的 system 是顶层字段，不在 messages 里 —— 归一成一条 system 消息
	if len(req.System) > 0 && string(req.System) != "null" {
		if text, media := extractText(req.System); text != "" {
			out = append(out, parsedMessage{Role: RoleSystem, Text: text, Media: media})
		}
	}

	for _, m := range req.Messages {
		// Claude 把 tool_result 塞在 user 消息的 content 数组里，
		// 语义上它是工具结果，拆成独立的 role=tool 记录
		toolResults := extractClaudeToolResults(m.Content)
		for _, tr := range toolResults {
			out = append(out, tr)
		}

		text, media := extractText(m.Content)
		toolUse := extractClaudeToolUse(m.Content)
		if text == "" && toolUse == "" {
			continue
		}
		out = append(out, parsedMessage{
			Role:      normalizeRole(m.Role),
			Text:      text,
			Media:     media,
			ToolCalls: toolUse,
		})
	}
	return out
}

func extractClaudeToolResults(raw json.RawMessage) []parsedMessage {
	var parts []contentPart
	if err := common.Unmarshal(raw, &parts); err != nil {
		return nil
	}
	var out []parsedMessage
	for _, p := range parts {
		if p.Type != "tool_result" {
			continue
		}
		text, media := extractText(p.Content)
		out = append(out, parsedMessage{
			Role:   RoleTool,
			Text:   text,
			Media:  media,
			ToolId: p.ToolUseId,
		})
	}
	return out
}

func extractClaudeToolUse(raw json.RawMessage) string {
	var parts []contentPart
	if err := common.Unmarshal(raw, &parts); err != nil {
		return ""
	}
	var uses []map[string]any
	for _, p := range parts {
		if p.Type != "tool_use" {
			continue
		}
		uses = append(uses, map[string]any{
			"id":    p.Id,
			"name":  p.Name,
			"input": json.RawMessage(p.Input),
		})
	}
	if len(uses) == 0 {
		return ""
	}
	b, err := common.Marshal(uses)
	if err != nil {
		return ""
	}
	return string(b)
}

func normalizeRole(role string) string {
	switch role {
	case RoleSystem, RoleUser, RoleAssistant, RoleTool:
		return role
	case "model": // Gemini 用 model 表示助手
		return RoleAssistant
	case "function":
		return RoleTool
	default:
		return RoleUser
	}
}

// ── 响应侧：抽出 assistant 消息 ──────────────────────────────────────────

// parseResponseMessage 从响应字节里抽出 assistant 消息。
// 返回 nil 表示这轮没有可记录的回复(请求失败、响应无法解析等)。
func parseResponseMessage(relayFormat string, body []byte, isStream bool) *parsedMessage {
	if len(body) == 0 {
		return nil
	}
	if isStream || looksLikeSSE(body) {
		return parseStreamResponse(relayFormat, body)
	}
	return parseNonStreamResponse(relayFormat, body)
}

func looksLikeSSE(body []byte) bool {
	head := body
	if len(head) > 256 {
		head = head[:256]
	}
	return strings.Contains(string(head), "data:")
}

type openAINonStreamResp struct {
	Choices []struct {
		Message struct {
			Content   json.RawMessage `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
			// 推理模型把思考过程放这里，且此时 content 常常是空串。
			// reasoning_content 是 DeepSeek/通义等的字段名，reasoning 是另一种写法。
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type claudeNonStreamResp struct {
	Content    []contentPart `json:"content"`
	StopReason string        `json:"stop_reason"`
	Usage      struct {
		OutputTokens int `json:"output_tokens"`
	} `json:"usage"`
}

func parseNonStreamResponse(relayFormat string, body []byte) *parsedMessage {
	if relayFormat == string(types.RelayFormatClaude) {
		var resp claudeNonStreamResp
		if err := common.Unmarshal(body, &resp); err != nil {
			return nil
		}
		var sb, think strings.Builder
		for _, p := range resp.Content {
			switch p.Type {
			case "text":
				if sb.Len() > 0 {
					sb.WriteString("\n")
				}
				sb.WriteString(p.Text)
			case "thinking":
				think.WriteString(p.Thinking)
			}
		}
		raw, _ := common.Marshal(resp.Content)
		toolUse := extractClaudeToolUse(raw)
		if sb.Len() == 0 && toolUse == "" && think.Len() == 0 {
			return nil
		}
		return &parsedMessage{
			Role:      RoleAssistant,
			Text:      sb.String(),
			ToolCalls: toolUse,
			Reasoning: think.String(),
			Finish:    normalizeFinish(resp.StopReason),
			Tokens:    resp.Usage.OutputTokens,
		}
	}

	var resp openAINonStreamResp
	if err := common.Unmarshal(body, &resp); err != nil {
		return nil
	}
	if len(resp.Choices) == 0 {
		return nil
	}
	c := resp.Choices[0]
	text, _ := extractText(c.Message.Content)
	toolCalls := ""
	if len(c.Message.ToolCalls) > 0 && string(c.Message.ToolCalls) != "null" {
		toolCalls = string(c.Message.ToolCalls)
	}
	reasoning := c.Message.ReasoningContent
	if reasoning == "" {
		reasoning = c.Message.Reasoning
	}
	if text == "" && toolCalls == "" && reasoning == "" {
		return nil
	}
	return &parsedMessage{
		Role:      RoleAssistant,
		Text:      text,
		ToolCalls: toolCalls,
		Reasoning: reasoning,
		Finish:    normalizeFinish(c.FinishReason),
		Tokens:    resp.Usage.CompletionTokens,
	}
}

// parseStreamResponse 把 SSE 的 delta 重组成完整消息。
//
// 重组失败不算错误 —— 拿不到就返回 nil，这轮没有 assistant 记录，
// 但请求侧的消息照常落盘。
func parseStreamResponse(relayFormat string, body []byte) *parsedMessage {
	acc := &streamAcc{tools: map[int]*toolAcc{}}

	for _, line := range strings.Split(string(body), "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" {
			continue
		}
		if payload == "[DONE]" {
			acc.terminated = true
			continue
		}
		if relayFormat == string(types.RelayFormatClaude) {
			acc.appendClaudeDelta(payload)
		} else {
			acc.appendOpenAIDelta(payload)
		}
	}

	toolCalls := acc.buildToolCalls()
	if acc.text.Len() == 0 && acc.reasoning.Len() == 0 && acc.finish == "" && toolCalls == "" {
		return nil
	}
	return &parsedMessage{
		Role:      RoleAssistant,
		Text:      acc.text.String(),
		ToolCalls: toolCalls,
		Reasoning: acc.reasoning.String(),
		Finish:    acc.finish,
		Tokens:    acc.tokens,
		// 流没跑到终止标记就断了(上游掉线/客户端断开)。此时 HTTP 状态早已是 200
		// —— SSE 头一 flush 出去就再也改不了了 —— 所以 errTypeOf 永远返回空，
		// 只有这里能识别。不标记的话，半句话会被当成模型的完整回复。
		Truncated: !acc.terminated,
	}
}

// streamAcc 累积 SSE 分片。工具调用在两家都是分片下发的
// (OpenAI: delta.tool_calls[].function.arguments 增量；
//
//	Claude: content_block_start 给 id/name，input_json_delta 增量给 input)，
//
// 所以必须按 index 攒齐再组装。
type streamAcc struct {
	text      strings.Builder
	reasoning strings.Builder
	finish    string
	tokens    int
	tools     map[int]*toolAcc
	order     []int
	// terminated 见到流的终止标记(OpenAI 的 [DONE] / Claude 的 message_stop)。
	//
	// ⚠️ 不能用 finish != "" 代替：带 finish_reason 的分片先到、流随后被切断
	// 是完全可能的，那样仍然是残缺数据。
	// 也不能去看 SSE 的 `event:` 行 —— 这里只遍历 data: 行，
	// Claude 的终止信号要从 data: 载荷里的 "type":"message_stop" 认。
	terminated bool
}

type toolAcc struct {
	Id   string
	Name string
	Args strings.Builder
}

func (a *streamAcc) tool(idx int) *toolAcc {
	t, ok := a.tools[idx]
	if !ok {
		t = &toolAcc{}
		a.tools[idx] = t
		a.order = append(a.order, idx)
	}
	return t
}

// buildToolCalls 把攒齐的工具调用序列化成 OpenAI 口径的 tool_calls JSON 字符串。
// 归一到一种形态，下游分析不必再分辨上游是哪家。
func (a *streamAcc) buildToolCalls() string {
	if len(a.order) == 0 {
		return ""
	}
	calls := make([]map[string]any, 0, len(a.order))
	for _, idx := range a.order {
		t := a.tools[idx]
		if t.Id == "" && t.Name == "" && t.Args.Len() == 0 {
			continue
		}
		calls = append(calls, map[string]any{
			"id":   t.Id,
			"type": "function",
			"function": map[string]any{
				"name":      t.Name,
				"arguments": t.Args.String(),
			},
		})
	}
	if len(calls) == 0 {
		return ""
	}
	b, err := common.Marshal(calls)
	if err != nil {
		return ""
	}
	return string(b)
}

func (a *streamAcc) appendOpenAIDelta(payload string) {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Content string `json:"content"`
				// 推理模型的思考分片，content 常常同时为空
				ReasoningContent string `json:"reasoning_content"`
				Reasoning        string `json:"reasoning"`
				ToolCalls        []struct {
					Index    *int   `json:"index"`
					Id       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
			FinishReason *string `json:"finish_reason"`
		} `json:"choices"`
		Usage *struct {
			CompletionTokens int `json:"completion_tokens"`
		} `json:"usage"`
	}
	if err := common.UnmarshalJsonStr(payload, &chunk); err != nil {
		return
	}
	for _, c := range chunk.Choices {
		a.text.WriteString(c.Delta.Content)
		a.reasoning.WriteString(c.Delta.ReasoningContent)
		a.reasoning.WriteString(c.Delta.Reasoning)
		for i, tc := range c.Delta.ToolCalls {
			idx := i
			if tc.Index != nil {
				idx = *tc.Index
			}
			t := a.tool(idx)
			if tc.Id != "" {
				t.Id = tc.Id
			}
			if tc.Function.Name != "" {
				t.Name = tc.Function.Name
			}
			t.Args.WriteString(tc.Function.Arguments)
		}
		if c.FinishReason != nil && *c.FinishReason != "" {
			a.finish = normalizeFinish(*c.FinishReason)
		}
	}
	if chunk.Usage != nil && chunk.Usage.CompletionTokens > 0 {
		a.tokens = chunk.Usage.CompletionTokens
	}
}

func (a *streamAcc) appendClaudeDelta(payload string) {
	var chunk struct {
		Type         string `json:"type"`
		Index        int    `json:"index"`
		ContentBlock *struct {
			Type string `json:"type"`
			Id   string `json:"id"`
			Name string `json:"name"`
		} `json:"content_block"`
		Delta struct {
			Type        string `json:"type"`
			Text        string `json:"text"`
			Thinking    string `json:"thinking"` // Claude 扩展思考
			PartialJson string `json:"partial_json"`
			StopReason  string `json:"stop_reason"`
		} `json:"delta"`
		Usage *struct {
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := common.UnmarshalJsonStr(payload, &chunk); err != nil {
		return
	}
	switch chunk.Type {
	case "content_block_start":
		if chunk.ContentBlock != nil && chunk.ContentBlock.Type == "tool_use" {
			t := a.tool(chunk.Index)
			t.Id = chunk.ContentBlock.Id
			t.Name = chunk.ContentBlock.Name
		}
	case "content_block_delta":
		switch chunk.Delta.Type {
		case "text_delta":
			a.text.WriteString(chunk.Delta.Text)
		case "thinking_delta":
			a.reasoning.WriteString(chunk.Delta.Thinking)
		case "input_json_delta":
			a.tool(chunk.Index).Args.WriteString(chunk.Delta.PartialJson)
		}
	case "message_delta":
		if chunk.Delta.StopReason != "" {
			a.finish = normalizeFinish(chunk.Delta.StopReason)
		}
		if chunk.Usage != nil && chunk.Usage.OutputTokens > 0 {
			a.tokens = chunk.Usage.OutputTokens
		}
	case "message_stop":
		a.terminated = true
	}
}

// normalizeFinish 把各家的结束原因归一到 OpenAI 口径。
func normalizeFinish(reason string) string {
	switch reason {
	case "end_turn", "stop_sequence":
		return "stop"
	case "max_tokens":
		return "length"
	case "tool_use":
		return "tool_calls"
	default:
		return reason
	}
}
