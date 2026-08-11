package openaicompat

import (
	"encoding/json"
	"testing"

	"github.com/Zer0Echo/tierflow-core/dto"
)

func rolesOfMessages(msgs []dto.Message) []string {
	out := make([]string, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, m.Role)
	}
	return out
}

func TestResponsesRequestToChatCompletionsRequest_Basic(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "m",
		Instructions: json.RawMessage(`"be brief"`),
		Input:        json.RawMessage(`[{"role":"user","content":"hi"}]`),
	}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	if got := rolesOfMessages(chat.Messages); len(got) != 2 || got[0] != "system" || got[1] != "user" {
		t.Fatalf("unexpected roles: %v", got)
	}
	if chat.Messages[0].StringContent() != "be brief" {
		t.Errorf("instructions not mapped to system: %q", chat.Messages[0].StringContent())
	}
	if chat.Messages[1].StringContent() != "hi" {
		t.Errorf("user content lost: %q", chat.Messages[1].StringContent())
	}
}

func TestResponsesRequestToChatCompletionsRequest_DeveloperRoleMappedToSystem(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model:        "m",
		Instructions: json.RawMessage(`"be brief"`),
		Input: json.RawMessage(`[
			{"role":"developer","content":[{"type":"input_text","text":"follow codex policy"}]},
			{"role":"user","content":"hi"}
		]`),
	}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}

	// developer -> system, rewritten in place so order is preserved (no hoist/merge).
	roles := rolesOfMessages(chat.Messages)
	if len(roles) != 3 || roles[0] != "system" || roles[1] != "system" || roles[2] != "user" {
		t.Fatalf("unexpected roles: %v", roles)
	}
	if chat.Messages[0].StringContent() != "be brief" {
		t.Fatalf("instructions system content wrong: %q", chat.Messages[0].StringContent())
	}
	if chat.Messages[1].StringContent() != "follow codex policy" {
		t.Fatalf("developer content not mapped to system: %q", chat.Messages[1].StringContent())
	}
}

func TestResponsesRequestToChatCompletionsRequest_DeveloperRoleMidConversationKeepsPosition(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "m",
		Input: json.RawMessage(`[
			{"role":"user","content":"hi"},
			{"role":"assistant","content":"hello"},
			{"role":"developer","content":"now be terse"},
			{"role":"user","content":"go on"}
		]`),
	}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}

	roles := rolesOfMessages(chat.Messages)
	if len(roles) != 4 || roles[0] != "user" || roles[1] != "assistant" || roles[2] != "system" || roles[3] != "user" {
		t.Fatalf("mid-conversation developer should map to system in place: %v", roles)
	}
	if chat.Messages[2].StringContent() != "now be terse" {
		t.Fatalf("mid-conversation instruction content lost: %q", chat.Messages[2].StringContent())
	}
}

func TestResponsesRequestToChatCompletionsRequest_BareString(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{Model: "m", Input: json.RawMessage(`"hello"`)}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	if len(chat.Messages) != 1 || chat.Messages[0].Role != "user" || chat.Messages[0].StringContent() != "hello" {
		t.Fatalf("bare string input not mapped: %+v", chat.Messages)
	}
}

func TestResponsesRequestToChatCompletionsRequest_ToolLoop(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "m",
		Input: json.RawMessage(`[
			{"role":"user","content":"q"},
			{"type":"function_call","call_id":"c1","name":"f","arguments":"{\"a\":1}"},
			{"type":"function_call_output","call_id":"c1","output":"res"}
		]`),
	}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	roles := rolesOfMessages(chat.Messages)
	if len(roles) != 3 || roles[0] != "user" || roles[1] != "assistant" || roles[2] != "tool" {
		t.Fatalf("unexpected roles: %v", roles)
	}
	calls := chat.Messages[1].ParseToolCalls()
	if len(calls) != 1 || calls[0].ID != "c1" || calls[0].Function.Name != "f" {
		t.Fatalf("tool call not mapped: %+v", calls)
	}
	if chat.Messages[2].ToolCallId != "c1" || chat.Messages[2].StringContent() != "res" {
		t.Errorf("function_call_output not mapped: %+v", chat.Messages[2])
	}
}

func TestResponsesRequestToChatCompletionsRequest_ToolsAndMultimodal(t *testing.T) {
	req := &dto.OpenAIResponsesRequest{
		Model: "m",
		Input: json.RawMessage(`[{"role":"user","content":[{"type":"input_text","text":"a"},{"type":"input_text","text":"b"}]}]`),
		Tools: json.RawMessage(`[{"type":"function","name":"f","description":"d","parameters":{"type":"object"}}]`),
	}
	chat, err := ResponsesRequestToChatCompletionsRequest(req)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	if chat.Messages[0].StringContent() != "a\nb" {
		t.Errorf("multimodal text parts not concatenated: %q", chat.Messages[0].StringContent())
	}
	if len(chat.Tools) != 1 || chat.Tools[0].Type != "function" || chat.Tools[0].Function.Name != "f" {
		t.Fatalf("tools not converted: %+v", chat.Tools)
	}
}

func TestChatCompletionsResponseToResponsesResponse_Text(t *testing.T) {
	msg := dto.Message{Role: "assistant"}
	msg.SetStringContent("hello")
	resp := &dto.OpenAITextResponse{
		Model:   "m",
		Choices: []dto.OpenAITextResponseChoice{{Message: msg, FinishReason: "stop"}},
		Usage:   dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8},
	}
	rr, usage, err := ChatCompletionsResponseToResponsesResponse(resp, "rid", 123)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	if rr.Object != "response" || string(rr.Status) != `"completed"` {
		t.Errorf("unexpected response envelope: object=%q status=%s", rr.Object, rr.Status)
	}
	if len(rr.Output) != 1 || rr.Output[0].Type != "message" || len(rr.Output[0].Content) != 1 ||
		rr.Output[0].Content[0].Text != "hello" {
		t.Fatalf("text output not mapped: %+v", rr.Output)
	}
	if usage.InputTokens != 5 || usage.OutputTokens != 3 || usage.TotalTokens != 8 {
		t.Errorf("usage mapping wrong: %+v", usage)
	}
}

func TestChatCompletionsResponseToResponsesResponse_ToolCalls(t *testing.T) {
	msg := dto.Message{Role: "assistant"}
	msg.SetToolCalls([]dto.ToolCallRequest{{
		ID:       "c1",
		Type:     "function",
		Function: dto.FunctionRequest{Name: "f", Arguments: `{"a":1}`},
	}})
	resp := &dto.OpenAITextResponse{
		Model:   "m",
		Choices: []dto.OpenAITextResponseChoice{{Message: msg, FinishReason: "tool_calls"}},
		Usage:   dto.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8},
	}
	rr, _, err := ChatCompletionsResponseToResponsesResponse(resp, "rid", 123)
	if err != nil {
		t.Fatalf("convert err: %v", err)
	}
	if len(rr.Output) != 1 || rr.Output[0].Type != "function_call" {
		t.Fatalf("function_call output not mapped: %+v", rr.Output)
	}
	out := rr.Output[0]
	if out.CallId != "c1" || out.Name != "f" {
		t.Errorf("function_call fields wrong: %+v", out)
	}
	if string(out.Arguments) != `"{\"a\":1}"` {
		t.Errorf("arguments should be JSON string value, got %s", out.Arguments)
	}
}
