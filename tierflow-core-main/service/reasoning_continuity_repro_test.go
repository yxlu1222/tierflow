package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/dto"
)

const (
	testUserA = 1001
	testUserB = 1002
	testModel = "deepseek-v4-flash"
)

// reproScenarioMessages 模拟 "qwen3.5-flash 路由到 deepseek-v4-flash" 的历史：
// 上一轮 assistant 发起了 tool_calls(由 qwen 生成,无 reasoning_content),客户端回传 tool 结果。
// DeepSeek 思考模式要求带 tool_calls 的 assistant 历史必须带回 reasoning_content,否则 400。
func reproScenarioMessages() []dto.Message {
	return []dto.Message{
		{Role: "user", Content: "查一下巴黎天气,适合散步吗?"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]`),
		},
		{Role: "tool", Content: "sunny, 20C", ToolCallId: "call_1"},
	}
}

func reproStrPtr(s string) *string { return &s }
func reproIntPtr(i int) *int       { return &i }

// 流式 reasoning 缓存(content-only 轮)：流式重组必须把【真实】reasoning 写进缓存，
// 但整段历史没有工具调用时【不】回填 —— 上游文档说这类轮次不需要回传。
func TestReasoningStreamCollectorContentOnlyCachesButDoesNotBackfill(t *testing.T) {
	rc := NewReasoningStreamCollector(constant.ChannelTypeDeepSeek, testUserA, testModel)
	if rc == nil {
		t.Fatal("collector should be non-nil for a continuity model")
	}
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ReasoningContent: reproStrPtr("先想一下，")}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ReasoningContent: reproStrPtr("这题答案是 4。")}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: reproStrPtr("2+2=")}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{Content: reproStrPtr("4")}},
	}})
	rc.Flush()

	// 缓存侧：真实草稿确实写进去了(同用户同模型作用域内可见)
	cached, ok := lookupReasoning(newReasoningScope(testUserA, testModel), "2+2=4", nil)
	if !ok || cached != "先想一下，这题答案是 4。" {
		t.Fatalf("expected streaming collector to cache the real reasoning, got %q ok=%v", cached, ok)
	}

	// 回填侧：整串没有任何 tool_calls → 一条都不补
	msgs := []dto.Message{
		{Role: "user", Content: "2+2 等于几?"},
		{Role: "assistant", Content: "2+2=4"},
		{Role: "user", Content: "那 3+3 呢?"},
	}
	real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs)
	if real != 0 || ph != 0 {
		t.Fatalf("pure-chat history must not be backfilled, got real=%d ph=%d", real, ph)
	}
	if got := msgs[1].GetReasoningContent(); got != "" {
		t.Fatalf("pure-chat assistant must stay untouched, got %q", got)
	}
}

// 【安全】缓存必须按用户分域：A 的思考链绝不能被回填进 B 的请求。
// 缓存命名空间是进程级的、开 Redis 后还跨实例共享，只按内容哈希会造成跨租户串号。
func TestReasoningCacheIsolatedPerUserAndModel(t *testing.T) {
	const content = "好的。"
	RememberReasoning(testUserA, testModel, content, nil, "A 的私有思考链")

	if got, ok := lookupReasoning(newReasoningScope(testUserA, testModel), content, nil); !ok || got != "A 的私有思考链" {
		t.Fatalf("same user+model should hit, got %q ok=%v", got, ok)
	}
	if got, ok := lookupReasoning(newReasoningScope(testUserB, testModel), content, nil); ok {
		t.Fatalf("cross-user leak: user B read user A's reasoning %q", got)
	}
	if got, ok := lookupReasoning(newReasoningScope(testUserA, "deepseek-v4-pro"), content, nil); ok {
		t.Fatalf("cross-model leak: other model read %q", got)
	}

	// 端到端:B 发同样内容的工具调用历史,不能拿到 A 的草稿
	msgs := []dto.Message{
		{Role: "user", Content: "hi"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"c1","type":"function","function":{"name":"f","arguments":"{}"}}]`),
		},
		{Role: "tool", Content: "ok", ToolCallId: "c1"},
		{Role: "assistant", Content: content},
	}
	EnsureAssistantReasoning(testUserB, testModel, msgs)
	if got := msgs[3].GetReasoningContent(); got == "A 的私有思考链" {
		t.Fatalf("cross-user leak through EnsureAssistantReasoning: %q", got)
	}
	if got := msgs[3].GetReasoningContent(); got != reasoningPlaceholder {
		t.Fatalf("expected placeholder for user B, got %q", got)
	}
}

// 空 tool_calls 数组 `[]` 与「无 tool_calls」必须归一成同一摘要：
// 响应侧无工具调用时传 nil，客户端回传同一条消息时常序列化成显式 `[]`。
// 两侧摘要不同 ⇒ key 对不上 ⇒ 真实草稿静默退化成占位。
func TestEmptyToolCallsArrayMatchesNilInCacheKey(t *testing.T) {
	if d := reasoningToolCallsDigest([]byte(`[]`)); d != "" {
		t.Fatalf("empty array digest must equal the nil digest, got %q", d)
	}
	RememberReasoning(testUserA, testModel, "final answer", nil, "REAL DRAFT")
	msgs := []dto.Message{
		{Role: "user", Content: "q"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"c1","type":"function","function":{"name":"f","arguments":"{}"}}]`),
		},
		{Role: "tool", Content: "r", ToolCallId: "c1"},
		{Role: "assistant", Content: "final answer", ToolCalls: json.RawMessage(`[]`)},
	}
	EnsureAssistantReasoning(testUserA, testModel, msgs)
	if got := msgs[3].GetReasoningContent(); got != "REAL DRAFT" {
		t.Fatalf("real cached draft must survive an explicit empty tool_calls array, got %q", got)
	}
}

// 既无内容也无工具调用的 assistant(content:"" + tool_calls:[])不该被注入 ——
// 那会造出一条「三无」消息,是最容易被上游拒的形状。
// 跳过判定必须用 ParseToolCalls 而非 len(ToolCalls)(后者对 `[]` 返回 2)。
func TestEnsureAssistantReasoningSkipsEmptyMessageWithEmptyToolCallsArray(t *testing.T) {
	msgs := []dto.Message{
		{Role: "user", Content: "q"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"c1","type":"function","function":{"name":"f","arguments":"{}"}}]`),
		},
		{Role: "tool", Content: "r", ToolCallId: "c1"},
		{Role: "assistant", Content: "", ToolCalls: json.RawMessage(`[]`)},
	}
	EnsureAssistantReasoning(testUserA, testModel, msgs)
	if got := msgs[3].GetReasoningContent(); got != "" {
		t.Fatalf("content-less, tool-call-less assistant must not be injected, got %q", got)
	}
	body, err := common.Marshal(&dto.GeneralOpenAIRequest{Model: testModel, Messages: msgs[3:]})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("outbound body must not carry reasoning_content for that message: %s", body)
	}
}

// 流式 reasoning 缓存往返(tool_calls 轮)：分片重组的 tool_calls 经归一化摘要后，
// 与客户端回传的 tool_calls(格式/键序不同)仍命中同一 key，回填到真实草稿。
func TestReasoningStreamCollectorToolCallRoundTrip(t *testing.T) {
	rc := NewReasoningStreamCollector(constant.ChannelTypeDeepSeek, testUserA, testModel)

	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ReasoningContent: reproStrPtr("需要查天气。")}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: reproIntPtr(0), ID: "call_abc", Type: "function", Function: dto.FunctionResponse{Name: "get_weather", Arguments: ""}},
		}}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: reproIntPtr(0), Function: dto.FunctionResponse{Arguments: `{"city":`}},
		}}},
	}})
	rc.Add(dto.ChatCompletionsStreamResponse{Choices: []dto.ChatCompletionsStreamResponseChoice{
		{Index: 0, Delta: dto.ChatCompletionsStreamResponseChoiceDelta{ToolCalls: []dto.ToolCallResponse{
			{Index: reproIntPtr(0), Function: dto.FunctionResponse{Arguments: `"Paris"}`}},
		}}},
	}})
	rc.Flush()

	// 客户端回传的 tool_calls：键序与流式重组不同(arguments 在前)，且多了 index 字段 —— 归一化后应仍命中
	msgs := []dto.Message{
		{Role: "user", Content: "巴黎天气?"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"index":0,"function":{"arguments":"{\"city\":\"Paris\"}","name":"get_weather"},"id":"call_abc","type":"function"}]`),
		},
		{Role: "tool", Content: "sunny", ToolCallId: "call_abc"},
	}
	real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs)
	if real != 1 || ph != 0 {
		t.Fatalf("expected real=1 placeholder=0 (canonical tool_calls digest should match), got real=%d ph=%d", real, ph)
	}
	if got := msgs[1].GetReasoningContent(); got != "需要查天气。" {
		t.Fatalf("expected real cached reasoning, got %q", got)
	}
}

// 兜底 helper 本身工作正常：对带 tool_calls 但缺 reasoning_content 的 assistant 历史注入占位。
func TestEnsureAssistantReasoningInjectsForToolCallReplay(t *testing.T) {
	msgs := reproScenarioMessages()
	real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs)
	if real+ph == 0 {
		t.Fatalf("expected backfill on the tool_calls assistant message, got real=%d ph=%d", real, ph)
	}
	body, err := common.Marshal(&dto.GeneralOpenAIRequest{Model: testModel, Messages: msgs})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("helper ran but reasoning_content missing in body: %s", body)
	}
}

// 判定按整段对话而非按 user 切段：只要历史里出现过工具调用，
// 靠前的纯聊天 assistant 也要补 —— 「先纯聊两句、再调工具」是极常见形状，
// 上游是否按段校验从未测出来,漏补是硬 400、多补已实测被接受。
func TestEnsureAssistantReasoningCoversWholeConversationOnceToolCallAppears(t *testing.T) {
	msgs := []dto.Message{
		{Role: "user", Content: "conv 你好"},
		{Role: "assistant", Content: "conv 你也好"}, // 工具调用之前的纯聊天轮
		{Role: "user", Content: "conv 巴黎天气?"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"call_conv","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]`),
		},
		{Role: "tool", Content: "sunny, 20C", ToolCallId: "call_conv"},
		{Role: "assistant", Content: "conv 巴黎晴天 20°C"},
		{Role: "user", Content: "conv 那伦敦呢?"},
	}
	real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs)
	if real+ph != 3 {
		t.Fatalf("expected all 3 assistant messages backfilled, got real=%d ph=%d", real, ph)
	}
	for _, i := range []int{1, 3, 5} {
		if msgs[i].GetReasoningContent() == "" {
			t.Fatalf("assistant at index %d must be backfilled", i)
		}
	}
}

// 完全没有工具调用的纯对话历史一条都不碰 —— 这是收窄的主要价值。
func TestEnsureAssistantReasoningSkipsPureChatConversation(t *testing.T) {
	msgs := []dto.Message{
		{Role: "system", Content: "you are helpful"},
		{Role: "user", Content: "pure 你好"},
		{Role: "assistant", Content: "pure 你也好"},
		{Role: "user", Content: "pure 再问一次"},
	}
	if real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs); real+ph != 0 {
		t.Fatalf("pure-chat conversation must not be backfilled, got real=%d ph=%d", real, ph)
	}
}

// 空 tool_calls 数组不能被当成"发生过工具调用"(len(ToolCalls) 会误判，ParseToolCalls 不会)。
func TestEnsureAssistantReasoningIgnoresEmptyToolCallsArray(t *testing.T) {
	msgs := []dto.Message{
		{Role: "user", Content: "empty tc 你好"},
		{Role: "assistant", Content: "empty tc 回复", ToolCalls: json.RawMessage(`[]`)},
		{Role: "user", Content: "再问一次"},
	}
	if real, ph := EnsureAssistantReasoning(testUserA, testModel, msgs); real+ph != 0 {
		t.Fatalf("empty tool_calls array must not count as a tool call, got real=%d ph=%d", real, ph)
	}
}

// 判定按【渠道类型 + 模型】内建，不再依赖任何系统选项。
func TestNeedsReasoningContinuity(t *testing.T) {
	for _, m := range []string{"deepseek-v4-flash", "deepseek-v4-pro", "DeepSeek-V4-Pro", "deepseek-v4-pro-max"} {
		if !NeedsReasoningContinuity(constant.ChannelTypeDeepSeek, m) {
			t.Fatalf("DeepSeek channel + %q should need continuity", m)
		}
	}
	for _, m := range []string{"deepseek-chat", "deepseek-reasoner", "deepseek-coder", ""} {
		if NeedsReasoningContinuity(constant.ChannelTypeDeepSeek, m) {
			t.Fatalf("DeepSeek channel + %q must not need continuity", m)
		}
	}
	for _, ct := range []int{constant.ChannelTypeOpenAI, constant.ChannelTypeAnthropic, constant.ChannelTypeGemini} {
		if NeedsReasoningContinuity(ct, "DeepSeek-V4-Pro") {
			t.Fatalf("channel type %d must not need continuity", ct)
		}
	}
}
