package openaicompat

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"

	"github.com/tidwall/gjson"
)

// ResponsesRequestToChatCompletionsRequest 把 OpenAI Responses API 请求(/v1/responses)
// 降级转换成 chat/completions 请求,让「只支持 chat 的上游」也能接住 responses 流量。
// 它是 ChatCompletionsRequestToResponsesRequest 的逆向。
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	if req == nil {
		return nil, errors.New("request is nil")
	}
	if req.Model == "" {
		return nil, errors.New("model is required")
	}

	messages := make([]dto.Message, 0)

	// instructions -> system 消息（置顶）
	if instr := responsesInstructionsToString(req.Instructions); instr != "" {
		sysMsg := dto.Message{Role: "system"}
		sysMsg.SetStringContent(instr)
		messages = append(messages, sysMsg)
	}

	// input -> messages
	inputMsgs, err := responsesInputToMessages(req.Input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, inputMsgs...)
	mapDeveloperRoleToSystem(messages)

	out := &dto.GeneralOpenAIRequest{
		Model:       req.Model,
		Messages:    messages,
		Stream:      req.Stream,
		Temperature: req.Temperature,
		TopP:        req.TopP,
		User:        req.User,
		Store:       req.Store,
		Metadata:    req.Metadata,
	}
	if req.MaxOutputTokens != nil {
		out.MaxTokens = req.MaxOutputTokens
	}
	if len(req.ParallelToolCalls) > 0 {
		var b bool
		if err := common.Unmarshal(req.ParallelToolCalls, &b); err == nil {
			out.ParallelTooCalls = &b
		}
	}
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		out.ReasoningEffort = req.Reasoning.Effort
	}
	if tools := responsesToolsToChatTools(req.Tools); len(tools) > 0 {
		out.Tools = tools
	}
	if tc := responsesToolChoiceToChat(req.ToolChoice); tc != nil {
		out.ToolChoice = tc
	}
	if rf := responsesTextToResponseFormat(req.Text); rf != nil {
		out.ResponseFormat = rf
	}

	return out, nil
}

// mapDeveloperRoleToSystem 把 Responses 的 `developer` 角色就地改写为 `system`。
// chat/completions 上游（DeepSeek 等）只认 system/user/assistant/tool，会对 `developer` 报
// 400 "unknown variant `developer`"。就地改写而非合并/上提，保留消息原有顺序——Codex 会在对话
// 中途注入 developer 指令，位置变了语义就变了。system 消息允许多条/连续，无需合并。
func mapDeveloperRoleToSystem(messages []dto.Message) {
	for i := range messages {
		if messages[i].Role == "developer" {
			messages[i].Role = "system"
		}
	}
}

// responsesInstructionsToString 解析 instructions（通常是 JSON 字符串）为纯文本。
func responsesInstructionsToString(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	res := gjson.ParseBytes(raw)
	if res.Type == gjson.String {
		return strings.TrimSpace(res.String())
	}
	return strings.TrimSpace(res.Raw)
}

// responsesInputToMessages 把 Responses 的 input(字符串或条目数组)转换为 chat messages。
func responsesInputToMessages(raw json.RawMessage) ([]dto.Message, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	res := gjson.ParseBytes(raw)

	// input 为裸字符串 -> 单条 user 消息
	if res.Type == gjson.String {
		msg := dto.Message{Role: "user"}
		msg.SetStringContent(res.String())
		return []dto.Message{msg}, nil
	}
	if !res.IsArray() {
		return nil, errors.New("invalid responses input: expected string or array")
	}

	messages := make([]dto.Message, 0)
	for _, item := range res.Array() {
		itemType := item.Get("type").String()
		role := item.Get("role").String()

		switch {
		case itemType == "function_call":
			tc := dto.ToolCallRequest{
				ID:   item.Get("call_id").String(),
				Type: "function",
				Function: dto.FunctionRequest{
					Name:      item.Get("name").String(),
					Arguments: responsesArgumentsToString(item.Get("arguments")),
				},
			}
			// 合并到上一条 assistant 消息（同一轮的多个工具调用），否则新建 assistant 消息
			if n := len(messages); n > 0 && messages[n-1].Role == "assistant" {
				existing := messages[n-1].ParseToolCalls()
				existing = append(existing, tc)
				messages[n-1].SetToolCalls(existing)
			} else {
				m := dto.Message{Role: "assistant"}
				m.SetStringContent("")
				m.SetToolCalls([]dto.ToolCallRequest{tc})
				messages = append(messages, m)
			}

		case itemType == "function_call_output":
			m := dto.Message{
				Role:       "tool",
				ToolCallId: item.Get("call_id").String(),
			}
			m.SetStringContent(responsesOutputFieldToString(item.Get("output")))
			messages = append(messages, m)

		case role != "":
			m := dto.Message{Role: role}
			setChatContentFromResponsesContent(&m, item.Get("content"), role)
			messages = append(messages, m)

		default:
			// reasoning / 其它条目：路由/对话无需，跳过
		}
	}
	return messages, nil
}

// setChatContentFromResponsesContent 把 Responses 的 content(字符串或 part 数组)写入 chat 消息。
// 纯文本折叠为字符串；含图片/音频等则构造 chat 多模态 part 数组。
func setChatContentFromResponsesContent(m *dto.Message, content gjson.Result, role string) {
	if !content.Exists() {
		m.SetStringContent("")
		return
	}
	if content.Type == gjson.String {
		m.SetStringContent(content.String())
		return
	}
	if !content.IsArray() {
		m.SetStringContent(content.Raw)
		return
	}

	parts := content.Array()
	onlyText := true
	for _, p := range parts {
		switch p.Get("type").String() {
		case "input_text", "output_text", "text", "":
		default:
			onlyText = false
		}
	}

	if onlyText {
		var sb strings.Builder
		for _, p := range parts {
			t := p.Get("text").String()
			if t == "" {
				continue
			}
			if sb.Len() > 0 {
				sb.WriteString("\n")
			}
			sb.WriteString(t)
		}
		m.SetStringContent(sb.String())
		return
	}

	chatParts := make([]map[string]any, 0, len(parts))
	for _, p := range parts {
		switch p.Get("type").String() {
		case "input_text", "output_text", "text":
			chatParts = append(chatParts, map[string]any{"type": "text", "text": p.Get("text").String()})
		case "input_image":
			url := p.Get("image_url").String()
			chatParts = append(chatParts, map[string]any{
				"type":      "image_url",
				"image_url": map[string]any{"url": url},
			})
		case "input_audio":
			chatParts = append(chatParts, map[string]any{
				"type":        "input_audio",
				"input_audio": jsonValue(p.Get("input_audio")),
			})
		case "input_file":
			chatParts = append(chatParts, map[string]any{
				"type": "file",
				"file": jsonValue(p.Get("file")),
			})
		default:
			if t := p.Get("text").String(); t != "" {
				chatParts = append(chatParts, map[string]any{"type": "text", "text": t})
			}
		}
	}
	m.Content = chatParts
}

// responsesToolsToChatTools 把 Responses 工具数组(扁平 name/parameters)转成 chat 工具(function 嵌套)。
func responsesToolsToChatTools(raw json.RawMessage) []dto.ToolCallRequest {
	if len(raw) == 0 {
		return nil
	}
	res := gjson.ParseBytes(raw)
	if !res.IsArray() {
		return nil
	}
	tools := make([]dto.ToolCallRequest, 0)
	for _, t := range res.Array() {
		typ := t.Get("type").String()
		if typ == "" {
			typ = "function"
		}
		if typ != "function" {
			// 内建工具(web_search 等)chat 不支持，跳过
			continue
		}
		tool := dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        t.Get("name").String(),
				Description: t.Get("description").String(),
			},
		}
		if params := t.Get("parameters"); params.Exists() {
			tool.Function.Parameters = jsonValue(params)
		}
		tools = append(tools, tool)
	}
	return tools
}

// responsesToolChoiceToChat 把 Responses 的 tool_choice 转成 chat 形态。
func responsesToolChoiceToChat(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	res := gjson.ParseBytes(raw)
	if res.Type == gjson.String {
		return res.String()
	}
	if res.IsObject() && res.Get("type").String() == "function" {
		name := res.Get("name").String()
		if name == "" {
			name = res.Get("function.name").String()
		}
		if name != "" {
			return map[string]any{
				"type":     "function",
				"function": map[string]any{"name": name},
			}
		}
	}
	return jsonValue(res)
}

// responsesTextToResponseFormat 把 Responses 的 text.format 还原成 chat 的 response_format。
func responsesTextToResponseFormat(raw json.RawMessage) *dto.ResponseFormat {
	if len(raw) == 0 {
		return nil
	}
	format := gjson.ParseBytes(raw).Get("format")
	if !format.Exists() {
		return nil
	}
	typ := format.Get("type").String()
	if typ == "" {
		return nil
	}
	rf := &dto.ResponseFormat{Type: typ}
	if typ == "json_schema" {
		// chat 的 json_schema 嵌套在 json_schema 字段里；Responses 把 schema 字段平铺在 format 下。
		schema := map[string]any{}
		for k, v := range format.Map() {
			if k == "type" {
				continue
			}
			schema[k] = jsonValue(v)
		}
		if len(schema) > 0 {
			if b, err := common.Marshal(schema); err == nil {
				rf.JsonSchema = b
			}
		}
	}
	return rf
}

// responsesArgumentsToString function_call.arguments 可能是字符串(JSON)或对象，统一成字符串。
func responsesArgumentsToString(arg gjson.Result) string {
	if !arg.Exists() {
		return ""
	}
	if arg.Type == gjson.String {
		return arg.String()
	}
	return arg.Raw
}

// responsesOutputFieldToString function_call_output.output 可能是字符串或结构，统一成字符串。
func responsesOutputFieldToString(out gjson.Result) string {
	if !out.Exists() {
		return ""
	}
	if out.Type == gjson.String {
		return out.String()
	}
	return out.Raw
}

// jsonValue 把 gjson 结果转成可被 common.Marshal 正确序列化的 Go 值。
func jsonValue(res gjson.Result) any {
	if !res.Exists() {
		return nil
	}
	return res.Value()
}
