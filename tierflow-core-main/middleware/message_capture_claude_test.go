package middleware_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/middleware"

	"github.com/gin-gonic/gin"
)

// TestMessageCaptureClaudeAndEdgeCases 覆盖 Claude 原生格式与几个边界：
//   - Claude 的顶层 system 字段归一成一条 system 消息
//   - 图文混排剥离图片、只留文本
//   - 纯图片无文字的消息整条跳过
//   - tool_use / tool_result 拆成独立记录
//   - 请求失败时 err 挂在 user 消息上，不伪造 assistant 行
func TestMessageCaptureClaudeAndEdgeCases(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	upstream := newClaudeUpstream()
	defer upstream.Close()
	gw := newClaudeGateway(upstream.URL)

	// ── 第 1 轮：Claude 顶层 system + 图文混排 + 一条纯图片消息 ────────
	turn1 := `{"model":"claude-sonnet-5","stream":true,
		"system":"你是一个代码审查助手。",
		"messages":[
			{"role":"user","content":[
				{"type":"text","text":"看看这段代码有什么问题"},
				{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgoAAAA"}}
			]},
			{"role":"assistant","content":[{"type":"text","text":"好的，我看到了。"}]},
			{"role":"user","content":[
				{"type":"image","source":{"type":"base64","media_type":"image/png","data":"QUJDREVGRw=="}}
			]}
		]}`
	postClaude(t, gw.URL, turn1, http.StatusOK)

	closeAndFlush(gw)
	lines := readCaptured(t, dir)

	fmt.Printf("\n════════ Claude 原生格式 ════════\n")
	fmt.Printf("客户端发了：顶层 system + 图文混排 user + assistant + 纯图片 user\n")
	fmt.Printf("落盘 %d 条：\n", len(lines))
	for _, l := range lines {
		fmt.Println("  " + l)
	}

	// system(顶层归一) + 图文 user + assistant + 上游回复 = 4；纯图片那条被跳过
	if len(lines) != 4 {
		t.Fatalf("期望 4 条(纯图片消息应被跳过)，实际 %d 条", len(lines))
	}
	assertContains(t, lines[0], `"role":"system"`, `你是一个代码审查助手`)
	assertContains(t, lines[1], `"role":"user"`, `"media":1`, `看看这段代码有什么问题`)
	assertContains(t, lines[2], `"role":"assistant"`)
	// 最后一条是上游的回复：文本 + 分片下发的工具调用被重组
	assertContains(t, lines[3], `"role":"assistant"`, `"finish":"tool_calls"`, `这段代码有个竞态问题。`)
	// tool_calls 必须是真的被重组出来的字段，而不是碰巧匹配到 finish 的值。
	// 三个 input_json_delta 分片要拼成完整的参数 JSON。
	assertContains(t, lines[3], `run_race_detector`, `toolu_01`, `./service`)
	if strings.Contains(lines[3], `"text":"这段代码有个竞态问题。","tool_calls"`) == false &&
		!strings.Contains(lines[3], `"tool_calls":"[`) {
		t.Fatalf("tool_calls 应该是独立字段(JSON 字符串)，而不是混进 text: %s", lines[3])
	}

	for _, l := range lines {
		if strings.Contains(l, "iVBORw0KGgo") || strings.Contains(l, "QUJDREVGRw") {
			t.Fatalf("图片 base64 泄漏到落盘数据: %s", l)
		}
	}
	fmt.Printf("✓ 两张图的 base64 均未落盘；纯图片消息整条跳过\n")
}

// TestMessageCaptureFailedRequest 验证请求失败时 err 挂在 user 消息上，
// 且不会伪造一条不存在的 assistant 记录。
func TestMessageCaptureFailedRequest(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	r := gin.New()
	r.Use(middleware.RequestId())
	r.Use(middleware.DecompressRequestMiddleware())
	r.Use(middleware.BodyStorageCleanup())
	r.Use(middleware.MessageCapture())
	r.POST("/v1/chat/completions", func(c *gin.Context) {
		c.Set("id", testUserId)
		c.Set("original_model", "gpt-4o")
		// 先把请求体读进 BodyStorage(与真 relay 同路径)，再返回上游错误
		_, _ = common.GetBodyStorage(c)
		c.JSON(http.StatusBadGateway, gin.H{"error": "upstream unavailable"})
	})
	gw := httptest.NewServer(r)

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"这次会失败"}]}`
	resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	resp.Body.Close()

	closeAndFlush(gw)
	lines := readCaptured(t, dir)

	fmt.Printf("\n════════ 失败请求 ════════\n")
	fmt.Printf("上游返回 502，落盘 %d 条：\n", len(lines))
	for _, l := range lines {
		fmt.Println("  " + l)
	}

	if len(lines) != 1 {
		t.Fatalf("期望只落盘 1 条 user 消息(不伪造 assistant)，实际 %d 条", len(lines))
	}
	assertContains(t, lines[0], `"role":"user"`, `"err":"upstream_error"`)
	if strings.Contains(lines[0], `"role":"assistant"`) {
		t.Fatal("不应该出现 assistant 记录")
	}
	fmt.Printf("✓ err=upstream_error 挂在 user 消息上，未伪造 assistant 行\n")
}

// ── Claude 测试基础设施 ─────────────────────────────────────────────────

func newClaudeGateway(upstreamURL string) *httptest.Server {
	r := gin.New()
	r.Use(middleware.RequestId())
	r.Use(middleware.DecompressRequestMiddleware())
	r.Use(middleware.BodyStorageCleanup())
	r.Use(middleware.MessageCapture())
	r.POST("/v1/messages", func(c *gin.Context) {
		c.Set("id", testUserId)
		c.Set("original_model", "claude-sonnet-5")
		relayLikeHandler(c, upstreamURL)
	})
	return httptest.NewServer(r)
}

// newClaudeUpstream 发 Claude 原生 SSE：content_block_delta + tool_use + message_delta。
func newClaudeUpstream() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		emit := func(s string) {
			fmt.Fprint(w, s+"\n")
			if flusher != nil {
				flusher.Flush()
			}
		}
		emit(`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"这段代码有个"}}`)
		emit(`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"竞态问题。"}}`)
		// 工具调用：content_block_start 给 id/name，input_json_delta 分片给参数
		emit(`data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01","name":"run_race_detector"}}`)
		emit(`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"pkg\":"}}`)
		emit(`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"./service\"}"}}`)
		emit(`data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":26}}`)
		emit(`data: [DONE]`)
	}))
}

func postClaude(t *testing.T, url string, body string, wantStatus int) {
	t.Helper()
	resp, err := http.Post(url+"/v1/messages", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != wantStatus {
		t.Fatalf("期望状态码 %d，实际 %d", wantStatus, resp.StatusCode)
	}
	// 排空响应体，确保 SSE 全部到达
	buf := make([]byte, 4096)
	for {
		if _, err := resp.Body.Read(buf); err != nil {
			break
		}
	}
}
