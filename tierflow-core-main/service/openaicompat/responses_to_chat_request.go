package openaicompat

import (
	"encoding/base64"
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
	messages = NormalizeChatSystemMessages(messages)

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

// NormalizeChatSystemMessages 把 instructions/system/developer 指令合并为对话最前面的一条
// system 消息。部分本地模型模板要求 system 只能出现一次且必须位于首条。
func NormalizeChatSystemMessages(messages []dto.Message) []dto.Message {
	systemParts := make([]string, 0)
	rest := make([]dto.Message, 0, len(messages))
	for _, message := range messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role == "system" || role == "developer" {
			if content := strings.TrimSpace(message.StringContent()); content != "" {
				systemParts = append(systemParts, content)
			}
			continue
		}
		rest = append(rest, message)
	}
	if len(systemParts) == 0 {
		return rest
	}
	system := dto.Message{Role: "system"}
	system.SetStringContent(strings.Join(systemParts, "\n\n"))
	return append([]dto.Message{system}, rest...)
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
			name := item.Get("name").String()
			if namespace := item.Get("namespace").String(); namespace != "" {
				name = encodeResponsesNamespaceToolName(namespace, name)
			}
			tc := dto.ToolCallRequest{
				ID:   item.Get("call_id").String(),
				Type: "function",
				Function: dto.FunctionRequest{
					Name:      name,
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

const responsesNamespaceToolPrefix = "tfns__"

// encodeResponsesNamespaceToolName 将 Responses namespace 工具转换为 chat/completions 可接受的
// 单层函数名。Raw URL-safe base64 不包含分隔符 "__"，因此可以无损还原。
func encodeResponsesNamespaceToolName(namespace, name string) string {
	if namespace == "" {
		return name
	}
	return responsesNamespaceToolPrefix +
		base64.RawURLEncoding.EncodeToString([]byte(namespace)) + "__" +
		base64.RawURLEncoding.EncodeToString([]byte(name))
}

// DecodeResponsesNamespaceToolName 还原经 encodeResponsesNamespaceToolName 编码的工具名。
func DecodeResponsesNamespaceToolName(encoded string) (namespace, name string, ok bool) {
	if !strings.HasPrefix(encoded, responsesNamespaceToolPrefix) {
		return "", encoded, false
	}
	parts := strings.Split(strings.TrimPrefix(encoded, responsesNamespaceToolPrefix), "__")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", encoded, false
	}
	namespaceBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || len(namespaceBytes) == 0 {
		return "", encoded, false
	}
	nameBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(nameBytes) == 0 {
		return "", encoded, false
	}
	return string(namespaceBytes), string(nameBytes), true
}

// responsesToolsToChatTools 把 Responses 工具数组转成 chat 工具。namespace 中的 function
// 会被扁平化并使用可逆名称编码；web_search/file_search 等本地模型无法执行的内置工具会跳过。
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
		appendResponsesTool(&tools, t, "", "")
	}
	return tools
}

func appendResponsesTool(tools *[]dto.ToolCallRequest, tool gjson.Result, namespace, namespaceDescription string) {
	typ := strings.ToLower(strings.TrimSpace(tool.Get("type").String()))
	if typ == "" {
		typ = "function"
	}
	switch typ {
	case "function":
		name := strings.TrimSpace(tool.Get("name").String())
		if name == "" {
			return
		}
		description := strings.TrimSpace(tool.Get("description").String())
		if namespace != "" {
			prefix := "Namespace: " + namespace + "."
			if namespaceDescription != "" {
				prefix += " " + namespaceDescription
			}
			if description != "" {
				description = strings.TrimSpace(prefix + "\n" + description)
			} else {
				description = prefix
			}
			name = encodeResponsesNamespaceToolName(namespace, name)
		}
		converted := dto.ToolCallRequest{
			Type: "function",
			Function: dto.FunctionRequest{
				Name:        name,
				Description: description,
			},
		}
		if params := tool.Get("parameters"); params.Exists() {
			converted.Function.Parameters = jsonValue(params)
		}
		*tools = append(*tools, converted)
	case "namespace":
		ns := strings.TrimSpace(tool.Get("name").String())
		if ns == "" || !tool.Get("tools").IsArray() {
			return
		}
		description := strings.TrimSpace(tool.Get("description").String())
		for _, nested := range tool.Get("tools").Array() {
			appendResponsesTool(tools, nested, ns, description)
		}
	default:
		// Responses 内置工具需要由服务端执行，chat/completions 本地模型没有对应执行器。
		return
	}
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
	if !res.IsObject() {
		return nil
	}
	typ := strings.ToLower(strings.TrimSpace(res.Get("type").String()))
	if typ == "function" {
		name := res.Get("name").String()
		if name == "" {
			name = res.Get("function.name").String()
		}
		if name != "" {
			namespace := res.Get("namespace").String()
			if namespace == "" {
				namespace = res.Get("function.namespace").String()
			}
			if namespace != "" {
				name = encodeResponsesNamespaceToolName(namespace, name)
			}
			return map[string]any{
				"type":     "function",
				"function": map[string]any{"name": name},
			}
		}
	}
	// namespace 与 Responses 内置工具无法直接表达为 chat tool_choice；保留自动选择，
	// 避免将上游不认识的类型原样发送给本地模型服务。
	return "auto"
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
