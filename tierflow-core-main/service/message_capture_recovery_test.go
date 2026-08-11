package service

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
)

func todayDate() string { return model.DateOf(time.Now().Unix()) }

// withCaptureDir 把落盘根目录指到临时目录，并在结束后还原。
func withCaptureDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.Dir
	t.Cleanup(func() { s.Dir = old })
	s.Dir = dir
	return dir
}

func countLines(t *testing.T, path string) int {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	// strings.Split("", "\n") 返回 [""]，长度是 1 —— 空文件必须单独判掉
	s := strings.TrimRight(string(b), "\n")
	if s == "" {
		return 0
	}
	return len(strings.Split(s, "\n"))
}

// 写失败后句柄必须被丢弃：bufio 的错误是粘滞的，留着它等于该用户当天的文件
// 在整个进程生命周期内再也写不进任何东西。
func TestWriteErrorDropsHandleSoNextWriteRecovers(t *testing.T) {
	withCaptureDir(t)
	w := newMsgWriter()
	defer w.closeAll()

	const uid, date = "100000000001", "2026-08-03"
	if err := w.write(uid, date, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "第一条"}); err != nil {
		t.Fatalf("首次写入失败: %v", err)
	}

	// 模拟磁盘故障：底层 fd 被关掉，bufio 一旦 flush 失败就会永久记住这个错误
	mf := w.files[uid+"/"+date]
	if mf == nil {
		t.Fatal("句柄未建立")
	}
	_ = mf.f.Close()
	// 写满缓冲区强制触发一次真实的底层写
	big := strings.Repeat("x", 64<<10)
	err := w.write(uid, date, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: big})
	if err == nil {
		t.Fatal("底层 fd 已关闭，期望写入报错")
	}
	if _, still := w.files[uid+"/"+date]; still {
		t.Fatal("写失败后句柄仍留在 map 里 —— 粘滞错误会让后续所有写入永久失败")
	}

	// 恢复后必须能继续写
	if err := w.write(uid, date, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "恢复后"}); err != nil {
		t.Fatalf("句柄重建后写入仍失败: %v", err)
	}
	w.flushAll()

	p := filepath.Join(operation_setting.GetMessageCaptureSetting().Dir, uid, MsgFileName(date))
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("读取落盘文件失败: %v", err)
	}
	if !strings.Contains(string(b), "恢复后") {
		t.Fatal("恢复后的记录没有落盘")
	}
}

// 跨天后旧日期的句柄必须被回收：key 含日期，旧 key 再也不会被写到，
// 不关就是每个活跃用户每天泄漏一个 fd，且永不回落。
func TestFlushAllEvictsStaleDateHandles(t *testing.T) {
	withCaptureDir(t)
	w := newMsgWriter()
	defer w.closeAll()

	const uid = "100000000002"
	// 一个"昨天"的句柄 + 一个"今天"的句柄
	yesterday := "2000-01-01"
	today := todayDate()
	if err := w.write(uid, yesterday, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "旧"}); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	if err := w.write(uid, today, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "新"}); err != nil {
		t.Fatalf("写入失败: %v", err)
	}
	if len(w.files) != 2 {
		t.Fatalf("期望 2 个句柄，实际 %d", len(w.files))
	}

	w.flushAll()

	if _, ok := w.files[uid+"/"+yesterday]; ok {
		t.Fatal("跨天后旧句柄未被回收 —— fd 会随天数无界增长")
	}
	if _, ok := w.files[uid+"/"+today]; !ok {
		t.Fatal("当天句柄不应被回收")
	}
	// 旧文件的内容必须已经落盘，不能因为回收而丢失
	if n := countLines(t, filepath.Join(operation_setting.GetMessageCaptureSetting().Dir, uid, MsgFileName(yesterday))); n != 1 {
		t.Fatalf("旧文件期望 1 行，实际 %d 行", n)
	}
}

// 句柄数触顶时按最久未写淘汰，保证不会打爆 RLIMIT_NOFILE。
func TestWriterCapsOpenHandles(t *testing.T) {
	withCaptureDir(t)
	w := newMsgWriter()
	defer w.closeAll()

	date := todayDate()
	for i := 0; i < maxOpenFiles+20; i++ {
		uid := "9" + strconv.Itoa(1000000000+i)
		if err := w.write(uid, date, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "x"}); err != nil {
			t.Fatalf("第 %d 次写入失败: %v", i, err)
		}
		if len(w.files) > maxOpenFiles {
			t.Fatalf("打开句柄数 %d 超过上限 %d", len(w.files), maxOpenFiles)
		}
	}
}

// 配额被拒时不得在 Redis 里留下净增量或无 TTL 的 key（本地分支同理：计数不变）。
func TestQuotaRejectionLeavesNoResidue(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()
	s.QuotaPerDay = 5

	const date = "2026-08-03"
	if !tryConsumeQuota(7, date, 4) {
		t.Fatal("首次 4 条应放行")
	}
	if tryConsumeQuota(7, date, 3) {
		t.Fatal("再要 3 条超过上限 5，应拒绝")
	}
	// 被拒之后剩余额度必须还是 1，而不是被扣走
	if !tryConsumeQuota(7, date, 1) {
		t.Fatal("被拒的那次不应消耗额度，剩余 1 条应能放行")
	}
	if tryConsumeQuota(7, date, 1) {
		t.Fatal("额度已用满，应拒绝")
	}
}

// 会话游标一旦被消费并前移，旧游标必须作废 ——
// 否则另一段开头相同的会话会捡走它，两段无关对话被并进同一个 cid。
func TestConsumedCursorIsInvalidatedAfterAdvance(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()

	const uid = 31
	turn1 := []parsedMessage{{Role: RoleUser, Text: "开场白"}}
	assistant := parsedMessage{Role: RoleAssistant, Text: "回答一"}

	// 第 1 轮：新会话
	cid, seq, fresh, matched := resolveSession(uid, turn1)
	if seq != 0 || len(fresh) != 1 || matched != "" {
		t.Fatalf("首轮应是新会话，实际 seq=%d fresh=%d matched=%q", seq, len(fresh), matched)
	}
	commitSession(uid, cid, append(append([]parsedMessage{}, turn1...), assistant), 2, matched)

	// 第 2 轮：续接，命中游标
	turn2 := append(append([]parsedMessage{}, turn1...), assistant, parsedMessage{Role: RoleUser, Text: "追问"})
	cid2, seq2, fresh2, matched2 := resolveSession(uid, turn2)
	if cid2 != cid || seq2 != 2 || len(fresh2) != 1 {
		t.Fatalf("第 2 轮应续接同一会话，实际 cid=%s seq=%d fresh=%d", cid2, seq2, len(fresh2))
	}
	commitSession(uid, cid2, turn2, 3, matched2)

	// 另一段**开头完全相同**的会话：旧游标已作废，必须判成新会话
	other := append(append([]parsedMessage{}, turn1...), assistant, parsedMessage{Role: RoleUser, Text: "另一个问题"})
	cid3, seq3, fresh3, _ := resolveSession(uid, other)
	if cid3 == cid {
		t.Fatal("已被消费的游标又被第二段会话捡走，两段无关对话会被并进同一个 cid")
	}
	if seq3 != 0 || len(fresh3) != len(other) {
		t.Fatalf("应判成新会话，实际 seq=%d fresh=%d", seq3, len(fresh3))
	}
}

// chainVisible 必须对齐 parseOpenAIRequest 的跳过条件：
// 两边一旦不同步，会话链就会在纯思考回复处断掉。
func TestChainVisibleMatchesRequestParserSkipRule(t *testing.T) {
	cases := []struct {
		name string
		pm   parsedMessage
		want bool
	}{
		{"纯思考回复(content 为空)", parsedMessage{Role: RoleAssistant, Reasoning: "想了很多"}, false},
		{"有正文", parsedMessage{Role: RoleAssistant, Text: "答案"}, true},
		{"只有工具调用", parsedMessage{Role: RoleAssistant, ToolCalls: `[{"id":"1"}]`}, true},
		{"工具结果(带 tool_call_id)", parsedMessage{Role: RoleTool, ToolId: "toolu_01"}, true},
		{"纯图片(全被剥离)", parsedMessage{Role: RoleUser, Media: 2}, false},
	}
	for _, c := range cases {
		if got := chainVisible(c.pm); got != c.want {
			t.Fatalf("%s: chainVisible=%v，期望 %v", c.name, got, c.want)
		}
	}
}

// 优雅退出时缓冲里的记录必须真正落盘 —— 这正是 StopMessageStore 存在的理由。
// bufio 有 32KB 缓冲，不主动 flush 的话最后一批对话就随进程一起消失了。
func TestCloseAllFlushesBufferedRecords(t *testing.T) {
	withCaptureDir(t)
	w := newMsgWriter()

	const uid, date = "100000000003", "2026-08-03"
	if err := w.write(uid, date, &MsgRecord{V: MsgFormatVersion, Role: RoleUser, Text: "还在缓冲里"}); err != nil {
		t.Fatalf("写入失败: %v", err)
	}

	p := filepath.Join(operation_setting.GetMessageCaptureSetting().Dir, uid, MsgFileName(date))
	if n := countLines(t, p); n != 0 {
		t.Fatalf("这条应还在 bufio 缓冲里(尚未 flush)，实际文件已有 %d 行", n)
	}

	w.closeAll()

	if n := countLines(t, p); n != 1 {
		t.Fatalf("closeAll 后期望落盘 1 行，实际 %d 行 —— 重启会静默丢掉最后一批记录", n)
	}
	if len(w.files) != 0 {
		t.Fatalf("closeAll 后仍留有 %d 个句柄", len(w.files))
	}
}
