package middleware

import (
	"strings"
	"testing"
)

func rolesOf(msgs []map[string]any) string {
	parts := make([]string, 0, len(msgs))
	for _, m := range msgs {
		parts = append(parts, m["role"].(string))
	}
	return strings.Join(parts, ",")
}

func TestExtractRoutingSlices(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantRoles string // 期望抽取的消息角色序列
	}{
		{
			name:      "first round only user",
			body:      `{"messages":[{"role":"user","content":"hi"}]}`,
			wantRoles: "user",
		},
		{
			name:      "system then user (no assistant after)",
			body:      `{"messages":[{"role":"system","content":"s"},{"role":"user","content":"u"}]}`,
			wantRoles: "user",
		},
		{
			name:      "user assistant -> U,A",
			body:      `{"messages":[{"role":"user","content":"u"},{"role":"assistant","content":"a"}]}`,
			wantRoles: "user,assistant",
		},
		{
			// 孤儿 tool（所属 assistant 不在窗口内）被裁掉，infer 侧本就用不上
			name:      "orphan tool before assistant is trimmed",
			body:      `{"messages":[{"role":"user","content":"u1"},{"role":"user","content":"u2"},{"role":"tool","content":"t1"},{"role":"assistant","content":"a2"}]}`,
			wantRoles: "user,assistant",
		},
		{
			// agent 工具循环：assistant/tool 尾窗完整保留，tool 排在所属 assistant 之后
			name:      "codex tool loop keeps assistant/tool tail in order",
			body:      `{"messages":[{"role":"system","content":"s"},{"role":"user","content":"task"},{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"shell","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"r1"},{"role":"assistant","content":"","tool_calls":[{"id":"c2","type":"function","function":{"name":"shell","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c2","content":"r2"}]}`,
			wantRoles: "user,assistant,tool,assistant,tool",
		},
		{
			name:      "no user -> empty",
			body:      `{"messages":[{"role":"assistant","content":"a"}]}`,
			wantRoles: "",
		},
		{
			name:      "no messages array",
			body:      `{"model":"auto"}`,
			wantRoles: "",
		},
	}
	for _, c := range cases {
		got := extractRoutingSlices([]byte(c.body))
		gotRoles := rolesOf(got)
		if gotRoles != c.wantRoles {
			t.Errorf("%s: got roles [%s], want [%s]", c.name, gotRoles, c.wantRoles)
		}
	}
}

func TestExtractRoutingSlicesPicksLastUser(t *testing.T) {
	body := `{"messages":[
		{"role":"user","content":"first"},
		{"role":"assistant","content":"a1"},
		{"role":"user","content":"LAST"}
	]}`
	got := extractRoutingSlices([]byte(body))
	if len(got) != 1 || got[0]["content"].(string) != "LAST" {
		t.Errorf("should re-anchor on last user message, got %+v", got)
	}
}

func TestExtractRoutingSlicesKeepsToolCalls(t *testing.T) {
	longArgs := strings.Repeat("x", maxRoutingToolArgsChars+500)
	body := `{"messages":[
		{"role":"user","content":"task"},
		{"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function","function":{"name":"shell","arguments":"` + longArgs + `"}}]},
		{"role":"tool","tool_call_id":"c1","name":"shell","content":"result"}
	]}`
	got := extractRoutingSlices([]byte(body))
	if rolesOf(got) != "user,assistant,tool" {
		t.Fatalf("unexpected roles: %s", rolesOf(got))
	}
	calls, ok := got[1]["tool_calls"].([]map[string]any)
	if !ok || len(calls) != 1 {
		t.Fatalf("assistant slice must keep tool_calls, got %+v", got[1])
	}
	fn := calls[0]["function"].(map[string]any)
	if fn["name"] != "shell" {
		t.Errorf("tool call name lost: %+v", fn)
	}
	if len(fn["arguments"].(string)) > maxRoutingToolArgsChars {
		t.Errorf("tool call arguments not truncated: len=%d", len(fn["arguments"].(string)))
	}
	if got[2]["name"] != "shell" {
		t.Errorf("tool slice must keep name, got %+v", got[2])
	}
}

func TestExtractRoutingSlicesTailWindowCap(t *testing.T) {
	var sb strings.Builder
	sb.WriteString(`{"messages":[{"role":"user","content":"task"}`)
	for i := 0; i < 10; i++ {
		sb.WriteString(`,{"role":"assistant","content":"","tool_calls":[{"id":"c","type":"function","function":{"name":"f","arguments":"{}"}}]}`)
		sb.WriteString(`,{"role":"tool","content":"r"}`)
	}
	sb.WriteString(`]}`)
	got := extractRoutingSlices([]byte(sb.String()))
	// user + 尾窗上限（窗口截断后若开头是孤儿 tool 还会再裁，本例窗口恰好以 assistant 开头）
	if len(got) > maxRoutingTailMessages+1 {
		t.Fatalf("tail window not capped: %d msgs (%s)", len(got), rolesOf(got))
	}
	if rolesOf(got)[:len("user,assistant")] != "user,assistant" {
		t.Fatalf("window must start user,assistant: %s", rolesOf(got))
	}
}

// --- OpenAI Responses API (`input`) 路由切片：/v1/responses（Codex 经 tierflow-codex）---

func TestExtractRoutingSlicesFromInput(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		wantRoles string
	}{
		{
			name:      "input bare string -> user",
			body:      `{"model":"auto","input":"hello world"}`,
			wantRoles: "user",
		},
		{
			name:      "input array role+string content",
			body:      `{"model":"auto","input":[{"role":"user","content":"hi"}]}`,
			wantRoles: "user",
		},
		{
			name:      "input array multimodal content parts (input_text)",
			body:      `{"model":"auto","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hard task"}]}]}`,
			wantRoles: "user",
		},
		{
			name:      "re-anchor on last user",
			body:      `{"input":[{"role":"user","content":"first"},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"a"}]},{"role":"user","content":"LAST"}]}`,
			wantRoles: "user",
		},
		{
			// codex 工具循环：function_call -> assistant(tool_calls)，function_call_output -> tool
			name:      "tool loop function_call / function_call_output",
			body:      `{"input":[{"role":"user","content":"task"},{"type":"function_call","call_id":"c1","name":"shell","arguments":"{}"},{"type":"function_call_output","call_id":"c1","output":"r1"}]}`,
			wantRoles: "user,assistant,tool",
		},
		{
			// reasoning 等无 role 条目跳过，不影响切片
			name:      "reasoning item ignored",
			body:      `{"input":[{"type":"reasoning","summary":[]},{"role":"user","content":"u"}]}`,
			wantRoles: "user",
		},
		{
			name:      "no user -> empty",
			body:      `{"input":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"a"}]}]}`,
			wantRoles: "",
		},
		{
			// messages 优先于 input：两者都在时仍走 messages
			name:      "messages takes precedence over input",
			body:      `{"messages":[{"role":"user","content":"m"}],"input":[{"role":"user","content":"i"}]}`,
			wantRoles: "user",
		},
	}
	for _, c := range cases {
		got := extractRoutingSlices([]byte(c.body))
		if gotRoles := rolesOf(got); gotRoles != c.wantRoles {
			t.Errorf("%s: got roles [%s], want [%s]", c.name, gotRoles, c.wantRoles)
		}
	}
}

func TestExtractRoutingSlicesFromInputKeepsToolCall(t *testing.T) {
	longArgs := strings.Repeat("x", maxRoutingToolArgsChars+500)
	body := `{"input":[
		{"role":"user","content":"task"},
		{"type":"function_call","call_id":"c1","name":"shell","arguments":"` + longArgs + `"},
		{"type":"function_call_output","call_id":"c1","name":"shell","output":"result"}
	]}`
	got := extractRoutingSlices([]byte(body))
	if rolesOf(got) != "user,assistant,tool" {
		t.Fatalf("unexpected roles: %s", rolesOf(got))
	}
	calls, ok := got[1]["tool_calls"].([]map[string]any)
	if !ok || len(calls) != 1 {
		t.Fatalf("assistant slice must keep tool_calls, got %+v", got[1])
	}
	fn := calls[0]["function"].(map[string]any)
	if fn["name"] != "shell" {
		t.Errorf("tool call name lost: %+v", fn)
	}
	if len(fn["arguments"].(string)) > maxRoutingToolArgsChars {
		t.Errorf("tool call arguments not truncated: len=%d", len(fn["arguments"].(string)))
	}
}

func TestResponsesContentToString(t *testing.T) {
	body := `{"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"part1"},{"type":"input_image","image_url":"x"},{"type":"input_text","text":"part2"}]}]}`
	got := extractRoutingSlices([]byte(body))
	if len(got) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(got))
	}
	content := got[0]["content"].(string)
	if content != "part1\npart2" {
		t.Errorf("multimodal text not concatenated as expected, got %q", content)
	}
}

func TestRequestHasMultimodalContent(t *testing.T) {
	cases := []struct {
		name string
		body string
		want bool
	}{
		{"chat text string", `{"messages":[{"role":"user","content":"hi"}]}`, false},
		{"chat text parts only", `{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`, false},
		{"chat image_url", `{"messages":[{"role":"user","content":[{"type":"text","text":"see"},{"type":"image_url","image_url":{"url":"x"}}]}]}`, true},
		{"chat input_audio", `{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{}}]}]}`, true},
		{"responses input_image", `{"input":[{"role":"user","content":[{"type":"input_text","text":"a"},{"type":"input_image","image_url":"x"}]}]}`, true},
		{"responses text parts", `{"input":[{"role":"user","content":[{"type":"input_text","text":"a"}]}]}`, false},
		{"responses bare string", `{"input":"hello"}`, false},
		{"no content", `{"model":"auto"}`, false},
	}
	for _, c := range cases {
		if got := requestHasMultimodalContent([]byte(c.body)); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

func TestContentToStringTruncation(t *testing.T) {
	long := strings.Repeat("a", maxRoutingContentChars+500)
	body := `{"messages":[{"role":"user","content":"` + long + `"}]}`
	got := extractRoutingSlices([]byte(body))
	if len(got) != 1 {
		t.Fatalf("expected 1 msg, got %d", len(got))
	}
	content := got[0]["content"].(string)
	if len(content) > maxRoutingContentChars {
		t.Errorf("content not truncated: len=%d > %d", len(content), maxRoutingContentChars)
	}
}
