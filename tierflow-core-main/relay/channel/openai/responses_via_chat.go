package openai

import (
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/logger"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
	"github.com/Zer0Echo/tierflow-core/relay/helper"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/types"

	"github.com/gin-gonic/gin"
)

// responsesEventID 由请求 id 派生一个 responses 风格的 id（resp_xxx）。
func responsesEventID(c *gin.Context) string {
	id := strings.TrimPrefix(helper.GetResponseID(c), "chatcmpl-")
	return "resp_" + id
}

// responsesUsageMap 把内部 usage 整理成 Responses API 的 usage 形态。
func responsesUsageMap(usage *dto.Usage) map[string]any {
	if usage == nil {
		usage = &dto.Usage{}
	}
	input := usage.InputTokens
	if input == 0 {
		input = usage.PromptTokens
	}
	output := usage.OutputTokens
	if output == 0 {
		output = usage.CompletionTokens
	}
	total := usage.TotalTokens
	if total == 0 {
		total = input + output
	}
	return map[string]any{
		"input_tokens":  input,
		"output_tokens": output,
		"total_tokens":  total,
		"input_tokens_details": map[string]any{
			"cached_tokens": usage.PromptTokensDetails.CachedTokens,
		},
		"output_tokens_details": map[string]any{
			"reasoning_tokens": usage.CompletionTokenDetails.ReasoningTokens,
		},
	}
}

// OaiChatToResponsesHandler 把上游 chat/completions 的非流式响应转换为 Responses API 响应。
func OaiChatToResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	var chatResp dto.OpenAITextResponse
	if err := common.Unmarshal(body, &chatResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if oaiErr := dto.GetOpenAIError(chatResp.Error); oaiErr != nil && oaiErr.Type != "" {
		return nil, types.WithOpenAIError(*oaiErr, resp.StatusCode)
	}

	respID := responsesEventID(c)
	createdAt := int(time.Now().Unix())
	responsesResp, usage, err := service.ChatCompletionsResponseToResponsesResponse(&chatResp, respID, createdAt)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if responsesResp.Model == "" {
		responsesResp.Model = info.UpstreamModelName
	}

	if usage == nil || usage.TotalTokens == 0 {
		text := service.ExtractOutputTextFromResponses(responsesResp)
		usage = service.ResponseText2Usage(c, text, info.UpstreamModelName, info.GetEstimatePromptTokens())
		responsesResp.Usage = usage
	}

	responseBody, err := common.Marshal(responsesResp)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
	}
	service.IOCopyBytesGracefully(c, resp, responseBody)
	return usage, nil
}

// OaiChatToResponsesStreamHandler 把上游 chat/completions 的 SSE 流转换为 Responses API 的 SSE 事件流。
//
// 事件序列对齐 OpenAI Responses 流式协议：
//
//	response.created / response.in_progress
//	（文本）output_item.added → content_part.added → output_text.delta* → output_text.done → content_part.done → output_item.done
//	（工具）output_item.added(function_call) → function_call_arguments.delta* → function_call_arguments.done → output_item.done
//	response.completed（带完整 output 与 usage）
func OaiChatToResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	responseId := responsesEventID(c)
	createdAt := time.Now().Unix()
	model := info.UpstreamModelName

	var (
		usage           = &dto.Usage{}
		textBuilder     strings.Builder
		usageText       strings.Builder
		sentCreated     bool
		nextOutputIndex int
		textItemEmitted bool
		textOutputIndex int
		textItemID      string
	)

	type toolState struct {
		outputIndex int
		itemID      string
		callID      string
		name        string
		args        strings.Builder
	}
	toolByChatIndex := make(map[int]*toolState)
	var toolOrder []*toolState

	emit := func(eventType string, payload map[string]any) {
		payload["type"] = eventType
		data, err := common.Marshal(payload)
		if err != nil {
			logger.LogError(c, "failed to marshal responses stream event: "+err.Error())
			return
		}
		helper.ResponseChunkData(c, dto.ResponsesStreamResponse{Type: eventType}, string(data))
	}

	inProgressResponse := func() map[string]any {
		return map[string]any{
			"id": responseId, "object": "response", "created_at": createdAt,
			"status": "in_progress", "model": model, "output": []any{},
		}
	}
	ensureCreated := func() {
		if sentCreated {
			return
		}
		emit("response.created", map[string]any{"response": inProgressResponse()})
		emit("response.in_progress", map[string]any{"response": inProgressResponse()})
		sentCreated = true
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		var chunk dto.ChatCompletionsStreamResponse
		if err := common.UnmarshalJsonStr(data, &chunk); err != nil {
			logger.LogError(c, "failed to unmarshal chat stream chunk: "+err.Error())
			return
		}
		if chunk.Model != "" {
			model = chunk.Model
		}
		if chunk.Usage != nil && chunk.Usage.TotalTokens != 0 {
			usage = chunk.Usage
		}
		ensureCreated()

		for _, choice := range chunk.Choices {
			if choice.Delta.Content != nil && *choice.Delta.Content != "" {
				delta := *choice.Delta.Content
				if !textItemEmitted {
					textOutputIndex = nextOutputIndex
					nextOutputIndex++
					textItemID = "msg_" + responseId
					emit("response.output_item.added", map[string]any{
						"output_index": textOutputIndex,
						"item": map[string]any{
							"type": "message", "id": textItemID, "status": "in_progress",
							"role": "assistant", "content": []any{},
						},
					})
					emit("response.content_part.added", map[string]any{
						"item_id": textItemID, "output_index": textOutputIndex, "content_index": 0,
						"part": map[string]any{"type": "output_text", "text": ""},
					})
					textItemEmitted = true
				}
				textBuilder.WriteString(delta)
				usageText.WriteString(delta)
				emit("response.output_text.delta", map[string]any{
					"item_id": textItemID, "output_index": textOutputIndex, "content_index": 0,
					"delta": delta,
				})
			}

			for _, tc := range choice.Delta.ToolCalls {
				idx := 0
				if tc.Index != nil {
					idx = *tc.Index
				}
				st, ok := toolByChatIndex[idx]
				if !ok {
					st = &toolState{
						outputIndex: nextOutputIndex,
						callID:      tc.ID,
						name:        tc.Function.Name,
					}
					nextOutputIndex++
					st.itemID = fmt.Sprintf("fc_%s_%d", responseId, st.outputIndex)
					if st.callID == "" {
						st.callID = st.itemID
					}
					toolByChatIndex[idx] = st
					toolOrder = append(toolOrder, st)
					emit("response.output_item.added", map[string]any{
						"output_index": st.outputIndex,
						"item": map[string]any{
							"type": "function_call", "id": st.itemID, "status": "in_progress",
							"call_id": st.callID, "name": st.name, "arguments": "",
						},
					})
				}
				if tc.ID != "" && st.callID == st.itemID {
					st.callID = tc.ID
				}
				if tc.Function.Name != "" && st.name == "" {
					st.name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					st.args.WriteString(tc.Function.Arguments)
					usageText.WriteString(tc.Function.Arguments)
					emit("response.function_call_arguments.delta", map[string]any{
						"item_id": st.itemID, "output_index": st.outputIndex,
						"delta": tc.Function.Arguments,
					})
				}
			}
		}
	})

	ensureCreated()

	type finalItem struct {
		outputIndex int
		item        map[string]any
	}
	finals := make([]finalItem, 0)

	if textItemEmitted {
		full := textBuilder.String()
		emit("response.output_text.done", map[string]any{
			"item_id": textItemID, "output_index": textOutputIndex, "content_index": 0,
			"text": full,
		})
		emit("response.content_part.done", map[string]any{
			"item_id": textItemID, "output_index": textOutputIndex, "content_index": 0,
			"part": map[string]any{"type": "output_text", "text": full},
		})
		item := map[string]any{
			"type": "message", "id": textItemID, "status": "completed", "role": "assistant",
			"content": []any{map[string]any{"type": "output_text", "text": full, "annotations": []any{}}},
		}
		emit("response.output_item.done", map[string]any{"output_index": textOutputIndex, "item": item})
		finals = append(finals, finalItem{textOutputIndex, item})
	}

	for _, st := range toolOrder {
		args := st.args.String()
		emit("response.function_call_arguments.done", map[string]any{
			"item_id": st.itemID, "output_index": st.outputIndex, "arguments": args,
		})
		item := map[string]any{
			"type": "function_call", "id": st.itemID, "status": "completed",
			"call_id": st.callID, "name": st.name, "arguments": args,
		}
		emit("response.output_item.done", map[string]any{"output_index": st.outputIndex, "item": item})
		finals = append(finals, finalItem{st.outputIndex, item})
	}

	if usage == nil || usage.TotalTokens == 0 {
		usage = service.ResponseText2Usage(c, usageText.String(), info.UpstreamModelName, info.GetEstimatePromptTokens())
	}

	sort.Slice(finals, func(i, j int) bool { return finals[i].outputIndex < finals[j].outputIndex })
	outputArr := make([]any, 0, len(finals))
	for _, f := range finals {
		outputArr = append(outputArr, f.item)
	}

	finalResp := map[string]any{
		"id": responseId, "object": "response", "created_at": createdAt,
		"status": "completed", "model": model, "output": outputArr,
		"usage": responsesUsageMap(usage),
	}
	emit("response.completed", map[string]any{"response": finalResp})

	return usage, nil
}
