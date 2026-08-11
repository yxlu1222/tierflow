package middleware

import (
	"fmt"
	"strings"
	"testing"
)

// TestEstimateContextTokensIgnoresAttachmentPayload
// 附件的 base64 负载不能按 bytes/3 计入上下文长度:一张 1MB 的图会被算成
// 35 万 token,直接顶过 240k 阈值,导致一个「短对话 + 一张图」的请求被强切到
// 高级桶多计费,或在高级桶已空时被「额度用完了」直接拒掉。
func TestEstimateContextTokensIgnoresAttachmentPayload(t *testing.T) {
	// ~1MB 的 base64 图片负载
	blob := strings.Repeat("A", 1<<20)
	body := []byte(fmt.Sprintf(
		`{"messages":[{"role":"user","content":[`+
			`{"type":"text","text":"总结这张图"},`+
			`{"type":"image_url","image_url":{"url":"data:image/png;base64,%s"}}`+
			`]}]}`, blob))

	got := estimateContextTokens(body)

	// 旧算法 len(body)/3 会接近 35 万。
	if naive := len(body) / 3; naive <= basicContextSwitchTokens {
		t.Fatalf("test setup is not exercising the bug: naive estimate %d is below threshold %d",
			naive, basicContextSwitchTokens)
	}
	if got > basicContextSwitchTokens {
		t.Errorf("estimate %d exceeds switch threshold %d; attachment payload is still being counted as prose",
			got, basicContextSwitchTokens)
	}
	// 附件仍应计入固定成本,不能当作零。
	if got < tokensPerAttachment {
		t.Errorf("estimate %d is below the per-attachment cost %d; attachment was ignored entirely",
			got, tokensPerAttachment)
	}
}

// TestEstimateContextTokensCountsText 纯文本仍按 bytes/3 估算,长上下文照常触发切换。
func TestEstimateContextTokensCountsText(t *testing.T) {
	body := []byte(`{"messages":[{"role":"user","content":"` +
		strings.Repeat("x", basicContextSwitchTokens*3+1024) + `"}]}`)

	if got := estimateContextTokens(body); got <= basicContextSwitchTokens {
		t.Errorf("estimate %d should exceed threshold %d for a genuinely long text context",
			got, basicContextSwitchTokens)
	}
}

// TestNonTextPayloadStats 覆盖 chat 与 Responses 两种结构的附件识别。
func TestNonTextPayloadStats(t *testing.T) {
	cases := []struct {
		name            string
		body            string
		wantAttachments int
		wantPayload     int
	}{
		{
			name:            "chat image_url",
			body:            `{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"abcde"}}]}]}`,
			wantAttachments: 1,
			wantPayload:     5,
		},
		{
			name:            "chat file",
			body:            `{"messages":[{"role":"user","content":[{"type":"file","file":{"file_data":"abc"}}]}]}`,
			wantAttachments: 1,
			wantPayload:     3,
		},
		{
			name:            "responses input_image",
			body:            `{"input":[{"role":"user","content":[{"type":"input_image","image_url":"abcdefg"}]}]}`,
			wantAttachments: 1,
			wantPayload:     7,
		},
		{
			name:            "text only",
			body:            `{"messages":[{"role":"user","content":[{"type":"text","text":"hello"}]}]}`,
			wantAttachments: 0,
			wantPayload:     0,
		},
		{
			name:            "string content is never multimodal",
			body:            `{"messages":[{"role":"user","content":"hello"}]}`,
			wantAttachments: 0,
			wantPayload:     0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			payload, attachments := nonTextPayloadStats([]byte(tc.body))
			if attachments != tc.wantAttachments {
				t.Errorf("attachments = %d, want %d", attachments, tc.wantAttachments)
			}
			if payload != tc.wantPayload {
				t.Errorf("payloadBytes = %d, want %d", payload, tc.wantPayload)
			}
		})
	}
}
