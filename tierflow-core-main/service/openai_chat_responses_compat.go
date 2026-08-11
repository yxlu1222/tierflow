package service

import (
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/service/openaicompat"
)

func ChatCompletionsRequestToResponsesRequest(req *dto.GeneralOpenAIRequest) (*dto.OpenAIResponsesRequest, error) {
	return openaicompat.ChatCompletionsRequestToResponsesRequest(req)
}

func ResponsesResponseToChatCompletionsResponse(resp *dto.OpenAIResponsesResponse, id string) (*dto.OpenAITextResponse, *dto.Usage, error) {
	return openaicompat.ResponsesResponseToChatCompletionsResponse(resp, id)
}

func ExtractOutputTextFromResponses(resp *dto.OpenAIResponsesResponse) string {
	return openaicompat.ExtractOutputTextFromResponses(resp)
}

// ResponsesRequestToChatCompletionsRequest 反向转换：/v1/responses 请求 → chat/completions 请求。
func ResponsesRequestToChatCompletionsRequest(req *dto.OpenAIResponsesRequest) (*dto.GeneralOpenAIRequest, error) {
	return openaicompat.ResponsesRequestToChatCompletionsRequest(req)
}

// ChatCompletionsResponseToResponsesResponse 反向转换：chat/completions 非流式响应 → responses 响应。
func ChatCompletionsResponseToResponsesResponse(resp *dto.OpenAITextResponse, respID string, createdAt int) (*dto.OpenAIResponsesResponse, *dto.Usage, error) {
	return openaicompat.ChatCompletionsResponseToResponsesResponse(resp, respID, createdAt)
}
