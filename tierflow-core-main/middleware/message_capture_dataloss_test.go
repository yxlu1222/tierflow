package middleware_test

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
)

// 这一组测试守的是"静默丢数据"类缺陷 —— 它们的共同特征是功能看着正常、
// 只是记下来的东西悄悄少了或悄悄错了，光看接口返回发现不了。

// settle 确保这一轮的捕获真正走完再去看结果。
//
// ⚠️ 光靠 resp.Body.Close() 不够：MessageCapture 的投递发生在 c.Next() **之后**，
// 而 http.Post 在响应体读完就返回了，两者之间有真实的时间差。
// httptest.Server.Close() 会阻塞到所有在途请求(含整条中间件链)结束，是可靠的屏障。
func settle(t *testing.T, resp *http.Response, gw *httptest.Server) {
	t.Helper()
	if resp != nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	gw.Close()
	flushPipeline()
}

// waitRecords 等异步管道把已投递的任务写完。
// 多轮测试必须逐轮同步：第 N+1 轮的会话续接依赖第 N 轮已经提交过游标。
func waitRecords(t *testing.T, want int64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if service.GetMessageCaptureStats().RecordsWritten >= want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("等待落盘超时：期望至少 %d 条，实际 %d 条", want, service.GetMessageCaptureStats().RecordsWritten)
}

// 历史长度超过当天配额时，必须记下尾部若干条并标记截断，
// 而不是一条都不记 —— 后者会把历史最长的重度用户整体排除在数据之外。
func TestLongHistoryStillRecordsTail(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	s := operation_setting.GetMessageCaptureSetting()
	oldQuota, oldReplay := s.QuotaPerDay, s.MaxReplayMessages
	defer func() { s.QuotaPerDay, s.MaxReplayMessages = oldQuota, oldReplay }()
	s.QuotaPerDay = 20
	s.MaxReplayMessages = 8

	upstream := newFakeUpstream()
	defer upstream.Close()
	gw := newGateway(upstream.URL)

	// 60 条历史，远超 QuotaPerDay=20 —— 修复前 tryConsumeQuota 永远为 false
	var msgs []string
	for i := 0; i < 60; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		msgs = append(msgs, fmt.Sprintf(`{"role":%q,"content":"第 %d 条"}`, role, i))
	}
	body := `{"model":"gpt-4o","stream":true,"messages":[` + strings.Join(msgs, ",") + `]}`

	resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	settle(t, resp, gw)
	lines := readCaptured(t, dir)

	if len(lines) == 0 {
		t.Fatal("历史超过配额上限时一条都没记 —— 重度用户会被静默排除在数据之外")
	}
	// 8 条重放 + 1 条 assistant
	if len(lines) != 9 {
		t.Fatalf("期望记下尾部 8 条 + assistant 共 9 条，实际 %d 条", len(lines))
	}
	// 记下的必须是**尾部**，不能是开头
	if !strings.Contains(lines[0], "第 52 条") {
		t.Fatalf("重放段应从第 52 条开始（尾部 8 条），实际首条为: %s", lines[0])
	}

	// 丢掉的前缀必须在索引上标记出来
	var rows []model.ConversationIndex
	if err := model.LOG_DB.Find(&rows).Error; err != nil {
		t.Fatalf("查索引失败: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("期望 1 行索引，实际 %d 行", len(rows))
	}
	if !rows[0].Truncated {
		t.Fatal("重放段被裁剪后必须标记 truncated —— 不完整却不标记等于数据在撒谎")
	}
}

// 流没跑到终止标记就断了(上游掉线)，落盘记录必须标 truncated。
// 此时 HTTP 状态早已是 200，errTypeOf 认不出来，只能靠终止标记判断。
func TestAbortedStreamIsMarkedTruncated(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	// 上游发一半就断，不发 [DONE]
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"这句话说到一半\"}}]}\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer upstream.Close()

	gw := newGateway(upstream.URL)

	resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json",
		strings.NewReader(`{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"讲个长故事"}]}`))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	settle(t, resp, gw)
	lines := readCaptured(t, dir)

	var assistant string
	for _, l := range lines {
		if strings.Contains(l, `"role":"assistant"`) {
			assistant = l
		}
	}
	if assistant == "" {
		t.Fatal("未找到 assistant 记录")
	}
	if !strings.Contains(assistant, `"truncated":true`) {
		t.Fatalf("流被中断却未标 truncated，半句话会被当成完整回复: %s", assistant)
	}
}

// 正常收尾的流不能被误标成截断 —— 否则整个字段就失去意义了。
func TestCompletedStreamIsNotMarkedTruncated(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	upstream := newFakeUpstream()
	defer upstream.Close()
	gw := newGateway(upstream.URL)

	resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json",
		strings.NewReader(`{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"你好"}]}`))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	settle(t, resp, gw)
	for _, l := range readCaptured(t, dir) {
		if strings.Contains(l, `"role":"assistant"`) && strings.Contains(l, `"truncated":true`) {
			t.Fatalf("完整的流被误标为截断: %s", l)
		}
	}
}

// 推理模型常常 content 为空、内容全在 reasoning_content 里。这种 assistant 消息
// 在下一轮请求里会被请求侧解析器整条跳过，所以**不能**算进会话链哈希 ——
// 否则游标永远对不上，每一轮都当新会话重放整段历史。
func TestReasoningOnlyReplyKeepsSessionChain(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	// 上游只发 reasoning_content，content 始终为空
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"我在想这个问题\"}}]}\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n")
		fmt.Fprint(w, "data: [DONE]\n")
		if flusher != nil {
			flusher.Flush()
		}
	}))
	defer upstream.Close()

	// 每轮用独立网关：gw.Close() 阻塞到整条中间件链跑完，是可靠的投递屏障。
	post := func(body string, wantTotal int64) {
		gw := newGateway(upstream.URL)
		resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json", strings.NewReader(body))
		if err != nil {
			t.Fatalf("请求失败: %v", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		gw.Close()
		waitRecords(t, wantTotal)
	}

	// 第 1 轮：user + 纯思考的 assistant
	post(`{"model":"gpt-4o","stream":true,"messages":[{"role":"user","content":"第一个问题"}]}`, 2)
	// 第 2 轮：客户端把上一轮那条"空 content"的 assistant 原样回显
	post(`{"model":"gpt-4o","stream":true,"messages":[
		{"role":"user","content":"第一个问题"},
		{"role":"assistant","content":""},
		{"role":"user","content":"第二个问题"}]}`, 4)

	flushPipeline()
	lines := readCaptured(t, dir)

	cids := map[string]bool{}
	for _, l := range lines {
		var rec struct {
			Cid string `json:"cid"`
		}
		if err := json.Unmarshal([]byte(l), &rec); err != nil {
			t.Fatalf("解析落盘行失败: %v", err)
		}
		cids[rec.Cid] = true
	}
	if len(cids) != 1 {
		t.Fatalf("两轮应属于同一会话，实际切成了 %d 个 cid —— 纯思考回复把会话链打断了", len(cids))
	}
	// 第一个问题只应出现一次：会话续上了就不会重放历史
	n := 0
	for _, l := range lines {
		if strings.Contains(l, "第一个问题") {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("「第一个问题」被记录了 %d 次，期望 1 次 —— 会话断链会导致整段历史重复落盘", n)
	}
}

// 请求体超过上限时必须整条跳过并单独计数，绝不能把截断的半截 JSON 喂给解析器。
func TestOversizedRequestBodyIsCountedNotMisparsed(t *testing.T) {
	dir := t.TempDir()
	setupTestEnv(t, dir)

	s := operation_setting.GetMessageCaptureSetting()
	old := s.MaxReqBodyBytes
	defer func() { s.MaxReqBodyBytes = old }()
	s.MaxReqBodyBytes = 1024

	upstream := newFakeUpstream()
	defer upstream.Close()
	gw := newGateway(upstream.URL)

	before := service.GetMessageCaptureStats().DroppedParse

	huge := strings.Repeat("很长的一段话", 500) // 远超 1KB
	resp, err := http.Post(gw.URL+"/v1/chat/completions", "application/json",
		strings.NewReader(fmt.Sprintf(`{"model":"gpt-4o","messages":[{"role":"user","content":%q}]}`, huge)))
	if err != nil {
		t.Fatalf("请求失败: %v", err)
	}
	settle(t, resp, gw)

	st := service.GetMessageCaptureStats()
	if st.DroppedReqTooLarge != 1 {
		t.Fatalf("期望 dropped_req_too_large=1，实际 %d", st.DroppedReqTooLarge)
	}
	if st.DroppedParse != before {
		t.Fatalf("超大请求体不应被计成解析失败（那会掩盖真正的配置问题），dropped_parse 从 %d 变成 %d", before, st.DroppedParse)
	}
	if lines := readCaptured(t, dir); len(lines) != 0 {
		t.Fatalf("超限请求不应落盘，实际落了 %d 条", len(lines))
	}
}
