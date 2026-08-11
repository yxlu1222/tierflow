package openai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/dto"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"
)

// 回归守卫:openai adaptor【不】做 reasoning 连续性处理。
//
// 这条能力按渠道类型内建在 relay/channel/deepseek 里。把 DeepSeek 配成 openai 类型渠道
// (例如指向聚合商)属于已知不覆盖的场景 —— 聚合商无法从渠道类型上识别。本用例把这个取舍
// 钉死,避免日后有人"顺手"在 openai adaptor 里加回来,把非 DeepSeek 上游也波及到。
func TestOpenAIAdaptorDoesNotInjectReasoningContinuity(t *testing.T) {
	req := &dto.GeneralOpenAIRequest{
		Model: "DeepSeek-V4-Pro",
		Messages: []dto.Message{
			{Role: "user", Content: "查一下巴黎天气,适合散步吗?"},
			{
				Role:      "assistant",
				Content:   "",
				ToolCalls: json.RawMessage(`[{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]`),
			},
			{Role: "tool", Content: "sunny, 20C", ToolCallId: "call_1"},
			{Role: "user", Content: "那伦敦呢?"},
		},
	}
	info := &relaycommon.RelayInfo{}
	// ChannelType 是 ChannelMeta 的提升字段，必须先挂上 ChannelMeta
	info.ChannelMeta = &relaycommon.ChannelMeta{UpstreamModelName: "DeepSeek-V4-Pro"}
	info.ChannelType = constant.ChannelTypeOpenAI

	out, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, req)
	if err != nil {
		t.Fatalf("ConvertOpenAIRequest: %v", err)
	}
	body, err := common.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(body), "reasoning_content") {
		t.Fatalf("openai adaptor must not inject reasoning_content: %s", body)
	}
}
