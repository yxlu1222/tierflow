package middleware_test

import (
	"bufio"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/middleware"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	glogger "gorm.io/gorm/logger"
)

// 这个测试同时是演示：它跑真实 HTTP —— 假上游发真 SSE，
// gin engine 按 router/relay-router.go 的实际注册顺序装中间件。
//
// 它验证三件在设计文档里被标为"待实测"的事：
//   V1  MessageCapture 注册在 BodyStorageCleanup 之后，post-Next 时 BodyStorage 仍存活
//   V2  teeWriter 不破坏 SSE 流式(Flush 正常转发，chunk 逐个到达)
//   V3  多轮对话只新增 1~2 条记录，seq 跨请求连续

const (
	testUserId = 42
	// 落盘用的是**对外 uid**，不是内部自增 id
	testUid = "100000000042"
)

// demoOutputDir 默认用临时目录(测试结束自动清理)；
// 设了 MSG_DEMO_DIR 则落到指定目录并保留，用于人工查看落盘效果：
//
//	MSG_DEMO_DIR=messages go test ./middleware/ -run TestMessageCaptureDemo
func demoOutputDir(t *testing.T) string {
	t.Helper()
	d := os.Getenv("MSG_DEMO_DIR")
	if d == "" {
		return t.TempDir()
	}
	if err := os.RemoveAll(d); err != nil {
		t.Fatalf("清理演示目录失败: %v", err)
	}
	return d
}

func TestMessageCaptureDemo(t *testing.T) {
	dir := demoOutputDir(t)
	setupTestEnv(t, dir)

	upstream := newFakeUpstream()
	defer upstream.Close()

	gw := newGateway(upstream.URL)

	fmt.Println("\n════════ 模拟 3 轮对话 ════════")

	// ── 第 1 轮：带 system prompt 的首次请求 ──────────────────────────
	turn1 := `{"model":"claude-sonnet-5","stream":true,"messages":[
		{"role":"system","content":"你是一个 Go 语言助手。"},
		{"role":"user","content":"帮我把这段代码改成并发的"}
	]}`
	reply1, chunks1 := post(t, gw.URL, turn1)
	fmt.Printf("\n[第1轮] 发送 2 条消息(system + user)\n")
	fmt.Printf("        SSE 分 %d 次到达 → 流式未被 tee 破坏\n", chunks1)
	fmt.Printf("        回复: %s\n", reply1)

	// ── 第 2 轮：带完整历史 + 图片 ────────────────────────────────────
	turn2 := fmt.Sprintf(`{"model":"claude-sonnet-5","stream":true,"messages":[
		{"role":"system","content":"你是一个 Go 语言助手。"},
		{"role":"user","content":"帮我把这段代码改成并发的"},
		{"role":"assistant","content":%q},
		{"role":"user","content":[
			{"type":"text","text":"这张截图里的报错是什么原因"},
			{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo..."}}
		]}
	]}`, reply1)
	reply2, _ := post(t, gw.URL, turn2)
	fmt.Printf("\n[第2轮] 发送 4 条消息(重发全部历史 + 1 条新 user，带 1 张图)\n")
	fmt.Printf("        回复: %s\n", reply2)

	// ── 第 3 轮 ───────────────────────────────────────────────────────
	turn3 := fmt.Sprintf(`{"model":"claude-sonnet-5","stream":true,"messages":[
		{"role":"system","content":"你是一个 Go 语言助手。"},
		{"role":"user","content":"帮我把这段代码改成并发的"},
		{"role":"assistant","content":%q},
		{"role":"user","content":[{"type":"text","text":"这张截图里的报错是什么原因"}]},
		{"role":"assistant","content":%q},
		{"role":"user","content":"谢谢，最后确认一下版本"}
	]}`, reply1, reply2)
	reply3, _ := post(t, gw.URL, turn3)
	fmt.Printf("\n[第3轮] 发送 6 条消息(重发全部历史 + 1 条新 user)\n")
	fmt.Printf("        回复: %s\n", reply3)

	// 等异步管道消费完
	closeAndFlush(gw)

	// ── 展示落盘结果 ─────────────────────────────────────────────────
	lines := readCaptured(t, dir)

	fmt.Printf("\n════════ 落盘结果 ════════\n")
	fmt.Printf("客户端总共发送了 2+4+6 = 12 条消息(含重复历史)\n")
	fmt.Printf("实际落盘 %d 条 —— 重发的历史被链式去重消掉了\n\n", len(lines))
	for _, l := range lines {
		fmt.Println("  " + l)
	}

	fmt.Printf("\n════════ 索引表 ════════\n")
	rows, err := model.ListUserConversations(testUid, model.DateOf(time.Now().Unix()))
	if err != nil {
		t.Fatalf("查询索引失败: %v", err)
	}
	for _, r := range rows {
		fmt.Printf("  cid=%s uid=%s date=%s 消息数=%d 模型=%s 截断=%v\n",
			r.ConversationId, r.Uid, r.Date, r.MessageCount, r.Models, r.Truncated)
	}

	stats := service.GetMessageCaptureStats()
	fmt.Printf("\n════════ 管道计数 ════════\n")
	fmt.Printf("  已写入=%d 队列满丢弃=%d 配额不足丢弃=%d 解析失败=%d 写盘失败=%d\n\n",
		stats.RecordsWritten, stats.DroppedQueueFull, stats.DroppedNoQuota,
		stats.DroppedParse, stats.WriteErrors)

	// ── 断言 ─────────────────────────────────────────────────────────
	// 2(首轮 system+user) + 1(回复) + 1(第2轮新 user) + 1(回复) + 1(第3轮新 user) + 1(回复) = 7
	if len(lines) != 7 {
		t.Fatalf("期望落盘 7 条，实际 %d 条", len(lines))
	}
	assertContains(t, lines[0], `"role":"system"`, `"seq":0`)
	assertContains(t, lines[1], `"role":"user"`, `"seq":1`)
	assertContains(t, lines[2], `"role":"assistant"`, `"seq":2`, `"finish":"stop"`)
	assertContains(t, lines[3], `"role":"user"`, `"seq":3`, `"media":1`)
	assertContains(t, lines[4], `"role":"assistant"`, `"seq":4`)
	assertContains(t, lines[5], `"role":"user"`, `"seq":5`)
	assertContains(t, lines[6], `"role":"assistant"`, `"seq":6`)

	// 图片必须被剥离：base64 一个字节都不能落盘
	for _, l := range lines {
		if strings.Contains(l, "iVBORw0KGgo") || strings.Contains(l, "image_url") {
			t.Fatalf("图片内容泄漏到落盘数据: %s", l)
		}
	}

	// 全部 7 条必须属于同一个会话 —— 链式前缀哈希把 3 次独立请求串起来了
	cid := extractField(lines[0], "cid")
	for i, l := range lines {
		if got := extractField(l, "cid"); got != cid {
			t.Fatalf("第 %d 条的 cid=%s 与首条 %s 不一致，会话被切断了", i, got, cid)
		}
	}

	if chunks1 < 2 {
		t.Fatalf("SSE 只收到 %d 个分片，流式可能被 tee 破坏了", chunks1)
	}
}

// TestMessageCaptureQuota 验证配额按请求原子判定：不会记出半截对话。
func TestMessageCaptureQuota(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)
	// 配额设成 3：第 1 轮需要 3 条(system+user+assistant)刚好用完，
	// 第 2 轮需要 2 条 → 放不下 → 整轮跳过，而不是记一半
	operation_setting.GetMessageCaptureSetting().QuotaPerDay = 3

	upstream := newFakeUpstream()
	defer upstream.Close()
	gw := newGateway(upstream.URL)

	turn1 := `{"model":"m","stream":true,"messages":[
		{"role":"system","content":"S"},{"role":"user","content":"U1"}]}`
	reply1, _ := post(t, gw.URL, turn1)

	turn2 := fmt.Sprintf(`{"model":"m","stream":true,"messages":[
		{"role":"system","content":"S"},{"role":"user","content":"U1"},
		{"role":"assistant","content":%q},{"role":"user","content":"U2"}]}`, reply1)
	post(t, gw.URL, turn2)

	closeAndFlush(gw)
	lines := readCaptured(t, dir)

	fmt.Printf("\n════════ 配额测试(上限 3 条) ════════\n")
	fmt.Printf("第1轮需 3 条 → 记下；第2轮需 2 条但只剩 0 → 整轮跳过\n")
	fmt.Printf("落盘 %d 条:\n", len(lines))
	for _, l := range lines {
		fmt.Println("  " + l)
	}
	stats := service.GetMessageCaptureStats()
	fmt.Printf("配额不足丢弃计数 = %d\n\n", stats.DroppedNoQuota)

	if len(lines) != 3 {
		t.Fatalf("期望落盘 3 条(不多不少，不能记半截)，实际 %d 条", len(lines))
	}
	if stats.DroppedNoQuota == 0 {
		t.Fatal("第 2 轮应该因配额不足被整轮跳过并计数")
	}
}

// ── 测试基础设施 ────────────────────────────────────────────────────────

func setupTestEnv(t *testing.T, dir string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	// 内存 SQLite 承载索引表
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{
		Logger: glogger.Discard,
	})
	if err != nil {
		t.Fatalf("打开测试库失败: %v", err)
	}
	if err := db.AutoMigrate(&model.ConversationIndex{}, &model.User{}); err != nil {
		t.Fatalf("迁移表失败: %v", err)
	}
	db.Exec("DELETE FROM conversation_indexes")
	model.LOG_DB = db
	// GetUidById 走主库；测试里两者同库
	model.DB = db
	uid := testUid
	// 必须 Unscoped：User 是软删模型，普通 Delete 留下的行仍占用 id 唯一约束
	db.Unscoped().Where("id = ?", testUserId).Delete(&model.User{})
	if err := db.Create(&model.User{Id: testUserId, Username: "demo", Uid: &uid}).Error; err != nil {
		t.Fatalf("建测试用户失败: %v", err)
	}

	// 无 Redis：走进程内降级路径
	common.RedisEnabled = false
	service.ResetMessageCaptureForTest()

	s := operation_setting.GetMessageCaptureSetting()
	s.Enabled = true
	s.Dir = dir
	s.QuotaPerDay = 200
	s.MaxContentBytes = 32768
	s.MaxTeeBytes = 131072
	s.QueueSize = 512

	service.StartMessageStore()
}

// newGateway 按 router/relay-router.go 的真实注册顺序装中间件。
func newGateway(upstreamURL string) *httptest.Server {
	r := gin.New()
	r.Use(middleware.RequestId())
	r.Use(middleware.DecompressRequestMiddleware())
	r.Use(middleware.BodyStorageCleanup())
	r.Use(middleware.MessageCapture()) // ← 必须在 BodyStorageCleanup 之后
	r.POST("/v1/chat/completions", func(c *gin.Context) {
		// 模拟 TokenAuth：它注册在路由组上，所以在全局中间件之后才执行。
		// MessageCapture 的 post-Next 段能读到这个值，正是设计所依赖的。
		c.Set("id", testUserId)
		c.Set("token_id", 7)
		c.Set("original_model", "claude-sonnet-5")
		relayLikeHandler(c, upstreamURL)
	})
	return httptest.NewServer(r)
}

// relayLikeHandler 模拟真实 relay 的行为：
// 通过 common.GetRequestBody 读请求体(与真 relay 同一条路径)，
// 再把上游 SSE 逐块转发给客户端并 Flush。
func relayLikeHandler(c *gin.Context, upstreamURL string) {
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	body, err := storage.Bytes()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	resp, err := http.Post(upstreamURL, "application/json", strings.NewReader(string(body)))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	defer resp.Body.Close()

	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.WriteHeader(http.StatusOK)

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		_, _ = c.Writer.WriteString(line + "\n\n")
		// 依赖 teeWriter 把 Flush 转发给底层 —— 漏了就会卡在这里
		c.Writer.Flush()
	}
}

// newFakeUpstream 发真正的 SSE：多个 delta 分片 + finish_reason + usage。
func newFakeUpstream() *httptest.Server {
	turn := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		turn++
		reply := fmt.Sprintf("这是第 %d 轮的回复", turn)
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)

		// 把回复拆成多个 delta，模拟真实流式
		runes := []rune(reply)
		mid := len(runes) / 2
		chunks := []string{string(runes[:mid]), string(runes[mid:])}
		for _, ch := range chunks {
			fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q}}]}\n", ch)
			if flusher != nil {
				flusher.Flush()
			}
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"completion_tokens\":18}}\n")
		fmt.Fprint(w, "data: [DONE]\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
}

// post 发一次请求，返回拼接后的回复文本与收到的 SSE 分片数。
func post(t *testing.T, url string, body string) (string, int) {
	t.Helper()
	resp, err := http.Post(url+"/v1/chat/completions", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	defer resp.Body.Close()

	var sb strings.Builder
	chunks := 0
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "[DONE]" {
			continue
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := common.UnmarshalJsonStr(payload, &chunk); err != nil {
			continue
		}
		for _, ch := range chunk.Choices {
			if ch.Delta.Content != "" {
				sb.WriteString(ch.Delta.Content)
				chunks++
			}
		}
	}
	return sb.String(), chunks
}

// flushPipeline 等异步管道把队列消费干净并 flush 到磁盘。
// closeAndFlush 是"看结果之前"的唯一正确屏障。
//
// ⚠️ 只调 flushPipeline() 是不够的：MessageCapture 的投递发生在 c.Next() **之后**，
// 而 http.Post 在响应体读完就返回了 —— 客户端拿到响应时中间件的后置段可能还没跑。
// httptest.Server.Close() 会阻塞到所有在途请求(含整条中间件链)结束，先关它再排空管道。
func closeAndFlush(gw *httptest.Server) {
	gw.Close()
	flushPipeline()
}

func flushPipeline() {
	service.StopMessageStore(3 * time.Second)
}

func readCaptured(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	err := filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".jsonl") {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		for _, l := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			if l != "" {
				out = append(out, l)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("读取落盘文件失败: %v", err)
	}
	return out
}

func assertContains(t *testing.T, line string, needles ...string) {
	t.Helper()
	for _, n := range needles {
		if !strings.Contains(line, n) {
			t.Fatalf("期望包含 %s 的行:\n  %s", n, line)
		}
	}
}

func extractField(line string, field string) string {
	key := fmt.Sprintf("%q:", field)
	i := strings.Index(line, key)
	if i < 0 {
		return ""
	}
	rest := line[i+len(key):]
	if !strings.HasPrefix(rest, `"`) {
		return ""
	}
	rest = rest[1:]
	j := strings.Index(rest, `"`)
	if j < 0 {
		return ""
	}
	return rest[:j]
}
