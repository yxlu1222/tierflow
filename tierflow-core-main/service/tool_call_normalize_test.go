package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/dto"
)

// ---- ScrubStreamToolCallDelta ----

// 真实案例：aiping.cn(转售阿里云百炼 qwen3.5-flash)流式 tool_calls 的后续分片
// 带显式 "id":""，会污染下游按字段存在性组装的客户端(CC Switch 等)。
func TestScrubAipingContinuationFragment(t *testing.T) {
	in := `{"choices": [{"delta": {"content": null, "reasoning_content": null, "tool_calls": [{"index": 0, "id": "", "type": "function", "function": {"arguments": "{\"city\": "}}]}, "finish_reason": null, "index": 0}], "object": "chat.completion.chunk", "model": "qwen3.5-flash", "provider": "阿里云百炼", "aiping_id": "caf2f93b"}`
	out := ScrubStreamToolCallDelta(in)
	if strings.Contains(out, `"id"`) {
		t.Fatalf("empty id should be removed, got: %s", out)
	}
	// type 非空保留；上游扩展字段原样透传
	for _, want := range []string{`"type": "function"`, `"provider": "阿里云百炼"`, `"aiping_id"`, `{\"city\": `} {
		if !strings.Contains(out, want) {
			t.Fatalf("expected %q preserved, got: %s", want, out)
		}
	}
}

func TestScrubFirstFragmentKeepsRealID(t *testing.T) {
	in := `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_27ea520a","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null,"index":0}]}`
	out := ScrubStreamToolCallDelta(in)
	if !strings.Contains(out, `"id":"call_27ea520a"`) {
		t.Fatalf("real id must be preserved, got: %s", out)
	}
	if !strings.Contains(out, `"name":"get_weather"`) {
		t.Fatalf("real name must be preserved, got: %s", out)
	}
}

func TestScrubEmptyNameAndNullType(t *testing.T) {
	in := `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"","type":null,"function":{"name":"","arguments":"x"}}]},"index":0}]}`
	out := ScrubStreamToolCallDelta(in)
	for _, gone := range []string{`"id"`, `"type"`, `"name"`} {
		if strings.Contains(out, gone) {
			t.Fatalf("expected %s removed, got: %s", gone, out)
		}
	}
	if !strings.Contains(out, `"arguments":"x"`) {
		t.Fatalf("arguments must be preserved, got: %s", out)
	}
}

func TestScrubCanonicalOpenAIFragmentUntouched(t *testing.T) {
	// OpenAI 规范后续分片(无 id/type/name 字段)必须逐字节原样返回
	in := `{"id":"chatcmpl_1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\":1}"}}]},"finish_reason":null,"index":0}]}`
	if out := ScrubStreamToolCallDelta(in); out != in {
		t.Fatalf("canonical fragment must pass byte-identical:\n in=%s\nout=%s", in, out)
	}
}

func TestScrubNoToolCallsFastPath(t *testing.T) {
	in := `{"choices":[{"delta":{"content":"hello"},"index":0}]}`
	if out := ScrubStreamToolCallDelta(in); out != in {
		t.Fatalf("non-tool chunk must pass byte-identical")
	}
}

func TestScrubMalformedJSONPassthrough(t *testing.T) {
	in := `{"choices":[{"delta":{"tool_calls":[{"id":""`
	if out := ScrubStreamToolCallDelta(in); out != in {
		t.Fatalf("malformed JSON must pass through unchanged")
	}
}

func TestScrubMultiChoiceMultiTool(t *testing.T) {
	in := `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"","type":"function","function":{"arguments":"a"}},{"index":1,"id":"call_keep","type":"function","function":{"name":"f2","arguments":""}}]}},{"index":1,"delta":{"tool_calls":[{"index":0,"id":"","function":{"arguments":"b"}}]}}]}`
	out := ScrubStreamToolCallDelta(in)
	if strings.Count(out, `"id"`) != 1 || !strings.Contains(out, `"id":"call_keep"`) {
		t.Fatalf("only the real id should remain, got: %s", out)
	}
}

// ---- RepairToolCallIDs ----

func msgsFromJSON(t *testing.T, s string) []dto.Message {
	t.Helper()
	var msgs []dto.Message
	if err := json.Unmarshal([]byte(s), &msgs); err != nil {
		t.Fatalf("bad fixture: %v", err)
	}
	return msgs
}

// 复刻线上失败请求形态(messages[5] role='tool' tool_call_id 缺失、assistant tool_calls id 为空)
func TestRepairPoisonedHistory(t *testing.T) {
	msgs := msgsFromJSON(t, `[
		{"role":"system","content":"sys"},
		{"role":"user","content":"do it"},
		{"role":"assistant","content":"","tool_calls":[{"id":"","type":"function","function":{"name":"shell","arguments":"{}"}}]},
		{"role":"tool","tool_call_id":"","content":"ok"},
		{"role":"assistant","content":"done"}
	]`)
	fixed := RepairToolCallIDs(msgs)
	if fixed != 2 {
		t.Fatalf("expected 2 repairs (assistant id + tool tool_call_id), got %d", fixed)
	}
	tcs := msgs[2].ParseToolCalls()
	if len(tcs) != 1 || tcs[0].ID == "" {
		t.Fatalf("assistant tool_call id not repaired: %+v", tcs)
	}
	if msgs[3].ToolCallId != tcs[0].ID {
		t.Fatalf("tool message must claim the repaired id: %q vs %q", msgs[3].ToolCallId, tcs[0].ID)
	}
}

func TestRepairMissingTypeAndIDField(t *testing.T) {
	msgs := msgsFromJSON(t, `[
		{"role":"assistant","content":"","tool_calls":[{"function":{"name":"shell","arguments":"{}"}}]},
		{"role":"tool","content":"ok"}
	]`)
	fixed := RepairToolCallIDs(msgs)
	if fixed != 3 {
		t.Fatalf("expected 3 repairs (id + type + tool_call_id), got %d", fixed)
	}
	raw := string(msgs[0].ToolCalls)
	if !strings.Contains(raw, `"type":"function"`) {
		t.Fatalf("type not repaired: %s", raw)
	}
}

func TestRepairParallelToolCallsInOrder(t *testing.T) {
	msgs := msgsFromJSON(t, `[
		{"role":"assistant","content":"","tool_calls":[
			{"id":"","type":"function","function":{"name":"a","arguments":"{}"}},
			{"id":"","type":"function","function":{"name":"b","arguments":"{}"}}]},
		{"role":"tool","tool_call_id":"","content":"ra"},
		{"role":"tool","tool_call_id":"","content":"rb"}
	]`)
	RepairToolCallIDs(msgs)
	tcs := msgs[0].ParseToolCalls()
	if msgs[1].ToolCallId != tcs[0].ID || msgs[2].ToolCallId != tcs[1].ID {
		t.Fatalf("order-based claim broken: %q/%q vs %q/%q", msgs[1].ToolCallId, msgs[2].ToolCallId, tcs[0].ID, tcs[1].ID)
	}
}

func TestRepairMixedPresentAndEmptyIDs(t *testing.T) {
	msgs := msgsFromJSON(t, `[
		{"role":"assistant","content":"","tool_calls":[
			{"id":"call_real","type":"function","function":{"name":"a","arguments":"{}"}},
			{"id":"","type":"function","function":{"name":"b","arguments":"{}"}}]},
		{"role":"tool","tool_call_id":"call_real","content":"ra"},
		{"role":"tool","tool_call_id":"","content":"rb"}
	]`)
	RepairToolCallIDs(msgs)
	tcs := msgs[0].ParseToolCalls()
	if tcs[0].ID != "call_real" {
		t.Fatalf("present id must not change, got %q", tcs[0].ID)
	}
	if msgs[2].ToolCallId != tcs[1].ID || msgs[2].ToolCallId == "" {
		t.Fatalf("empty tool msg must claim the repaired (unclaimed) id, got %q want %q", msgs[2].ToolCallId, tcs[1].ID)
	}
}

func TestRepairHealthyHistoryUntouched(t *testing.T) {
	orig := `[{"id":"call_1","type":"function","function":{"name":"a","arguments":"{}"}}]`
	msgs := msgsFromJSON(t, `[
		{"role":"assistant","content":"","tool_calls":`+orig+`},
		{"role":"tool","tool_call_id":"call_1","content":"ok"}
	]`)
	if fixed := RepairToolCallIDs(msgs); fixed != 0 {
		t.Fatalf("healthy history must not be repaired, got %d", fixed)
	}
	if string(msgs[0].ToolCalls) != orig {
		t.Fatalf("healthy tool_calls must stay byte-identical:\n%s\n%s", orig, msgs[0].ToolCalls)
	}
}

func TestRepairDoesNotCrossUserBoundary(t *testing.T) {
	msgs := msgsFromJSON(t, `[
		{"role":"assistant","content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"a","arguments":"{}"}}]},
		{"role":"user","content":"interrupt"},
		{"role":"tool","tool_call_id":"","content":"orphan"}
	]`)
	RepairToolCallIDs(msgs)
	if msgs[2].ToolCallId != "" {
		t.Fatalf("orphan tool msg after user boundary must not claim stale id, got %q", msgs[2].ToolCallId)
	}
}
