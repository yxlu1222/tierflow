package openaicompat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"
)

// ChatCompletionsResponseToResponsesResponse 把 chat/completions 的非流式响应转换成
// OpenAI Responses API 响应,使 /v1/responses 客户端(如 Codex)能消费 chat 上游的结果。
// 它是 ResponsesResponseToChatCompletionsResponse 的逆向。
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, respID string, createdAt int) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	if resp == nil {
		return nil, nil, errors.New("response is nil")
	}

	var text string
	var toolCalls []dto.ToolCallRequest
	if len(resp.Choices) > 0 {
		msg := resp.Choices[0].Message
		text = msg.StringContent()
		toolCalls = msg.ParseToolCalls()
	}

	outputs := make([]dto.ResponsesOutput, 0, 1+len(toolCalls))
	if text != "" {
		outputs = append(outputs, dto.ResponsesOutput{
			Type:   "message",
			ID:     "msg_" + respID,
			Status: "completed",
			Role:   "assistant",
			Content: []dto.ResponsesOutputContent{
				{Type: "output_text", Text: text},
			},
		})
	}
	for i, tc := range toolCalls {
		if tc.Type != "" && tc.Type != "function" {
			continue
		}
		name := strings.TrimSpace(tc.Function.Name)
		if name == "" {
			continue
		}
		namespace := ""
		if decodedNamespace, decodedName, ok := DecodeResponsesNamespaceToolName(name); ok {
			namespace = decodedNamespace
			name = decodedName
		}
		callID := strings.TrimSpace(tc.ID)
		if callID == "" {
			callID = fmt.Sprintf("call_%s_%d", respID, i)
		}
		outputs = append(outputs, dto.ResponsesOutput{
			Type:      "function_call",
			ID:        fmt.Sprintf("fc_%s_%d", respID, i),
			Status:    "completed",
			CallId:    callID,
			Name:      name,
			Namespace: namespace,
			Arguments: argumentsStringToRaw(tc.Function.Arguments),
		})
	}

	model := resp.Model
	usage := ChatUsageToResponsesUsage(&resp.Usage)

	out := &dto.OpenAIResponsesResponse{
		ID:        respID,
		Object:    "response",
		CreatedAt: createdAt,
		Status:    json.RawMessage(`"completed"`),
		Model:     model,
		Output:    outputs,
		Usage:     usage,
	}
	return out, usage, nil
}

// ChatUsageToResponsesUsage 把 chat usage 字段映射到 responses usage(input/output_tokens),
// 同时保留 chat 字段(prompt/completion_tokens),供网关计费层复用。
func ChatUsageToResponsesUsage(src *dto.Usage) *dto.Usage {
	u := &dto.Usage{}
	if src == nil {
		return u
	}
	u.PromptTokens = src.PromptTokens
	u.CompletionTokens = src.CompletionTokens
	u.TotalTokens = src.TotalTokens
	if u.TotalTokens == 0 {
		u.TotalTokens = u.PromptTokens + u.CompletionTokens
	}
	u.InputTokens = src.PromptTokens
	u.OutputTokens = src.CompletionTokens
	u.PromptTokensDetails = src.PromptTokensDetails
	u.CompletionTokenDetails = src.CompletionTokenDetails
	details := src.PromptTokensDetails
	u.InputTokensDetails = &details
	return u
}

// argumentsStringToRaw 把 chat 工具参数(字符串)转成 responses 的 arguments 字段(JSON 字符串值)。
func argumentsStringToRaw(args string) json.RawMessage {
	if args == "" {
		return json.RawMessage(`""`)
	}
	raw, err := common.Marshal(args)
	if err != nil {
		return json.RawMessage(`""`)
	}
	return raw
}
