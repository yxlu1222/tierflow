package deepseek

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/dto"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
)

func toolCallHistory() []dto.Message {
	return []dto.Message{
		{Role: "user", Content: "查一下巴黎天气,适合散步吗?"},
		{
			Role:      "assistant",
			Content:   "",
			ToolCalls: json.RawMessage(`[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]`),
		},
		{Role: "tool", Content: "sunny, 20C", ToolCallId: "call_1"},
		{Role: "user", Content: "那伦敦呢?"},
	}
}

func newInfo(model string) *relaycommon.RelayInfo {
	info := &relaycommon.RelayInfo{}
	// ChannelType 是 ChannelMeta 的提升字段，必须先挂上 ChannelMeta
	info.ChannelMeta = &relaycommon.ChannelMeta{UpstreamModelName: model}
	info.ChannelType = constant.ChannelTypeDeepSeek
	info.UserId = 4242
	return info
}

// 回归守卫:DeepSeek 渠道类型【零配置】自动回传 reasoning_content。
// 旧实现由系统选项 ReasoningContinuityModels 开启且默认为空,等于整条链路是死代码;
// 现改为按渠道类型内建,不设置任何选项也必须生效。
func TestDeepSeekAdaptorBackfillsWithoutAnyOption(t *testing.T) {
	// 刻意清空选项,证明不再依赖它
	common.OptionMapRWMutex.Lock()
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()

	req := &dto.GeneralOpenAIRequest{Model: "deepseek-v4-flash", Messages: toolCallHistory()}
	out, err := (&Adaptor{}).ConvertOpenAIRequest(nil, newInfo("deepseek-v4-flash"), req)
	if err != nil {
		t.Fatalf("ConvertOpenAIRequest: %v", err)
	}
	body, err := common.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("regression: deepseek channel must backfill reasoning_content with zero config: %s", body)
	}
	t.Logf("OK zero-config backfill on deepseek channel: %s", body)
}

// 同渠道下的非思考模型(deepseek-chat 等)不注入 —— 它们不跑思考模式,塞该字段反而可能被拒。
func TestDeepSeekAdaptorSkipsNonThinkingModel(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Model: "deepseek-chat", Messages: toolCallHistory()}
	out, err := (&Adaptor{}).ConvertOpenAIRequest(nil, newInfo("deepseek-chat"), req)
	if err != nil {
		t.Fatalf("ConvertOpenAIRequest: %v", err)
	}
	body, _ := common.Marshal(out)
	if strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("deepseek-chat must not be injected: %s", body)
	}
}

// -none 后缀显式关闭思考模式时不注入:上游不要求回传,注入是多余的拒收风险。
func TestDeepSeekAdaptorSkipsWhenThinkingDisabled(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{Model: "deepseek-v4-flash-none", Messages: toolCallHistory()}
	out, err := (&Adaptor{}).ConvertOpenAIRequest(nil, newInfo("deepseek-v4-flash-none"), req)
	if err != nil {
		t.Fatalf("ConvertOpenAIRequest: %v", err)
	}
	body, _ := common.Marshal(out)
	if strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("thinking-disabled request must not be injected: %s", body)
	}
	if !strings.Contains(string(body), `"disabled"`) {
		t.Fatalf("expected thinking disabled in outbound body: %s", body)
	}
}

// 纯对话历史(无 tool_calls)不注入 —— DeepSeek 文档说这类轮次不需要回传。
func TestDeepSeekAdaptorSkipsPureChatHistory(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "deepseek-v4-pro",
		Messages: []dto.Message{
			{Role: "user", Content: "2+2 等于几?"},
			{Role: "assistant", Content: "2+2=4"},
			{Role: "user", Content: "那 3+3 呢?"},
		},
	}
	out, err := (&Adaptor{}).ConvertOpenAIRequest(nil, newInfo("deepseek-v4-pro"), req)
	if err != nil {
		t.Fatalf("ConvertOpenAIRequest: %v", err)
	}
	body, _ := common.Marshal(out)
	if strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("pure-chat history must not be injected: %s", body)
	}
}
