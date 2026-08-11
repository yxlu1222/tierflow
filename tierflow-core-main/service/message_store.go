package service

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/logger"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
)

// 消息记录的异步管道。
//
// 总原则：热路径只做内存拷贝，解析 JSON / 算哈希 / 查 Redis / 写磁盘全部在这里。
// 任何失败只计数 + 记日志，绝不回压到用户请求上。

var (
	msgCh     chan *MsgTask
	msgChOnce sync.Once
	msgQuit   chan struct{}
	msgDone   chan struct{}

	// 各类丢弃/失败计数，暴露到 middleware/stats.go —— 静默丢弃是最坏的失败模式，
	// 事后看数据只会觉得"这个用户不活跃"。
	msgDroppedQueueFull   atomic.Int64
	msgDroppedNoQuota     atomic.Int64
	msgDroppedParse       atomic.Int64
	msgDroppedNoUid       atomic.Int64
	msgDroppedReqTooLarge atomic.Int64
	msgRespTruncated      atomic.Int64
	msgWriteErrors        atomic.Int64
	msgRecordsWritten     atomic.Int64
)

// CountMsgReqTooLarge 请求体超过 MaxReqBodyBytes、整条跳过。
// 由中间件在热路径调用(单次原子加，可忽略不计)。
func CountMsgReqTooLarge() {
	msgDroppedReqTooLarge.Add(1)
}

// MessageCaptureStats 记录管道的运行计数。
type MessageCaptureStats struct {
	QueueDepth         int   `json:"queue_depth"`
	QueueCap           int   `json:"queue_cap"`
	DroppedQueueFull   int64 `json:"dropped_queue_full"`
	DroppedNoQuota     int64 `json:"dropped_no_quota"`
	DroppedParse       int64 `json:"dropped_parse"`
	DroppedNoUid       int64 `json:"dropped_no_uid"`
	DroppedReqTooLarge int64 `json:"dropped_req_too_large"`
	RespTruncated      int64 `json:"resp_truncated"`
	WriteErrors        int64 `json:"write_errors"`
	RecordsWritten     int64 `json:"records_written"`
}

func GetMessageCaptureStats() MessageCaptureStats {
	s := MessageCaptureStats{
		DroppedQueueFull:   msgDroppedQueueFull.Load(),
		DroppedNoQuota:     msgDroppedNoQuota.Load(),
		DroppedParse:       msgDroppedParse.Load(),
		DroppedNoUid:       msgDroppedNoUid.Load(),
		DroppedReqTooLarge: msgDroppedReqTooLarge.Load(),
		RespTruncated:      msgRespTruncated.Load(),
		WriteErrors:        msgWriteErrors.Load(),
		RecordsWritten:     msgRecordsWritten.Load(),
	}
	if msgCh != nil {
		s.QueueDepth = len(msgCh)
		s.QueueCap = cap(msgCh)
	}
	return s
}

// StartMessageStore 启动异步写入协程。幂等。
//
// 注意：**不**用 IsMasterNode 守卫 —— 每个节点都要写自己那份。
// 只有将来的清理任务才是 master-only。
func StartMessageStore() {
	msgChOnce.Do(func() {
		size := operation_setting.GetMessageCaptureSetting().QueueSize
		if size <= 0 {
			size = 512
		}
		msgCh = make(chan *MsgTask, size)
		msgQuit = make(chan struct{})
		msgDone = make(chan struct{})
		quit, done := msgQuit, msgDone
		gopool.Go(func() {
			logger.LogInfo(context.Background(), fmt.Sprintf("message capture store started: queue=%d", size))
			msgWriteLoop(quit, done)
		})
	})
}

// ResetMessageCaptureForTest 重置管道与进程内配额/游标，仅供测试使用。
func ResetMessageCaptureForTest() {
	if msgCh != nil && msgQuit != nil {
		StopMessageStore(3 * time.Second)
	}
	msgChOnce = sync.Once{}
	msgCh = nil
	msgQuit = nil
	msgDone = nil
	msgDroppedQueueFull.Store(0)
	msgDroppedNoQuota.Store(0)
	msgDroppedParse.Store(0)
	msgDroppedNoUid.Store(0)
	msgDroppedReqTooLarge.Store(0)
	msgRespTruncated.Store(0)
	msgWriteErrors.Store(0)
	msgRecordsWritten.Store(0)
	resetLocalQuotaForTest()
}

// SubmitMsgTask 由中间件在热路径调用：**非阻塞**投递。
//
// 绝不能写成阻塞发送 —— 那样磁盘或 Redis 一慢，延迟就直接传导到用户请求上。
func SubmitMsgTask(task *MsgTask) {
	if msgCh == nil || task == nil {
		return
	}
	select {
	case msgCh <- task:
	default:
		msgDroppedQueueFull.Add(1)
	}
}

// StopMessageStore 排空队列并关闭全部文件句柄。给定超时后放弃 ——
// 记录模块不能拖住进程退出。
func StopMessageStore(timeout time.Duration) {
	if msgCh == nil || msgQuit == nil {
		return
	}
	select {
	case <-msgQuit: // 已经关过了
	default:
		close(msgQuit)
	}
	select {
	case <-msgDone:
	case <-time.After(timeout):
		logger.LogWarn(context.Background(), "message capture store shutdown timed out")
	}
}

func msgWriteLoop(quit <-chan struct{}, done chan<- struct{}) {
	defer close(done)

	w := newMsgWriter()
	defer w.closeAll()

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case task := <-msgCh:
			processMsgTask(w, task)
		case <-ticker.C:
			w.flushAll()
		case <-quit:
			// 排空剩余任务后由 defer 收尾
			for {
				select {
				case task := <-msgCh:
					processMsgTask(w, task)
				default:
					return
				}
			}
		}
	}
}

// processMsgTask 是单条任务的完整处理链：
// 解析 → 会话识别 → 配额判定 → 落盘 → 更新索引。
func processMsgTask(w *msgWriter, task *MsgTask) {
	if task == nil || task.UserId <= 0 {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			msgDroppedParse.Add(1)
			logger.LogError(context.Background(), fmt.Sprintf("message capture panic: %v", r))
		}
	}()

	// 落盘用对外 uid，不用内部自增 id。查询走进程内永久缓存(uid 不可变)，
	// 且发生在异步阶段，不影响热路径。
	// 拿不到 uid(老用户尚未回填)就丢弃该条 —— 按 model.PublicUid 的约定，
	// 空串意味着不可用，不能退回内部 id。
	uid := model.GetUidById(task.UserId)
	if uid == "" {
		msgDroppedNoUid.Add(1)
		return
	}

	reqMsgs := parseRequestMessages(task.RelayFormat, task.ReqBody)
	if len(reqMsgs) == 0 {
		msgDroppedParse.Add(1)
		return
	}

	cid, startSeq, fresh, matchedChain := resolveSession(task.UserId, reqMsgs)

	setting := operation_setting.GetMessageCaptureSetting()

	// 游标未命中时 fresh 是整段历史。不设上限会有两个后果：同一段历史被反复落盘，
	// 以及 len(pending) 直接超过当天配额导致该用户永远记不下任何东西。
	// 只保留尾部若干条，被丢掉的前缀在索引上标记 truncated —— 数据不完整就得说出来。
	replayDropped := false
	if startSeq == 0 && len(fresh) > 0 {
		limit := setting.MaxReplayMessages
		if limit <= 0 {
			limit = 50
		}
		// 再压一次：整轮(重放 + assistant)必须能塞进一天的配额，否则又回到"永远记不下"。
		if q := setting.QuotaPerDay; q > 1 && limit > q-1 {
			limit = q - 1
		}
		if len(fresh) > limit {
			fresh = fresh[len(fresh)-limit:]
			replayDropped = true
		}
	}

	// 响应侧的 assistant 消息(可能没有：请求失败/流式中断/无法解析)
	isStream := task.RespEncoding == "" && looksLikeSSE(task.RespBody)
	assistant := parseResponseMessage(task.RelayFormat, task.RespBody, isStream)

	pending := make([]parsedMessage, 0, len(fresh)+1)
	pending = append(pending, fresh...)
	if assistant != nil {
		if assistant.Tokens == 0 && task.CompletionTokens > 0 {
			assistant.Tokens = task.CompletionTokens
		}
		// 响应字节被 tee 截断 => 重组出来的文本必然不完整，据实标记。
		// parseStreamResponse 也会在流没跑到终止标记时置位，两个来源都要计数。
		if task.RespTruncated {
			assistant.Truncated = true
		}
		if assistant.Truncated {
			msgRespTruncated.Add(1)
		}
		pending = append(pending, *assistant)
	}
	if len(pending) == 0 {
		return
	}

	// 请求失败时，错误类型挂到最后一条 user 消息上 ——
	// assistant 消息不存在就不该伪造一条。
	if task.ErrType != "" {
		for i := len(pending) - 1; i >= 0; i-- {
			if pending[i].Role == RoleUser {
				pending[i].Err = task.ErrType
				break
			}
		}
	}

	date := model.DateOf(task.Ts)

	// 按请求原子判定配额：要么全记，要么全不记。
	// 配额 key 用内部 id：它是纯运行时状态、不对外暴露，省一次 uid 转换。
	if !tryConsumeQuota(task.UserId, date, len(pending)) {
		msgDroppedNoQuota.Add(1)
		// 会话已存在时，把它标记成被截断，避免分析时误读成"用户聊几轮就走了"
		if startSeq > 0 {
			_ = model.UpsertConversationIndex(cid, uid, date, task.Ts, task.Model, 0, true)
		}
		return
	}

	maxContent := setting.MaxContentBytes
	seq := startSeq
	writeFailed := false
	for _, pm := range pending {
		rec := MsgRecord{
			V:         MsgFormatVersion,
			Cid:       cid,
			Seq:       seq,
			Role:      pm.Role,
			Ts:        task.Ts,
			Uid:       uid,
			ReqId:     task.RequestId,
			Text:      pm.Text,
			Model:     task.Model,
			Tokens:    pm.Tokens,
			Media:     pm.Media,
			Finish:    pm.Finish,
			ToolCalls: pm.ToolCalls,
			Reasoning: pm.Reasoning,
			ToolId:    pm.ToolId,
			Err:       pm.Err,
		}
		if pm.Truncated {
			rec.Truncated = true
		}
		if maxContent > 0 && len(rec.Text) > maxContent {
			rec.Text = rec.Text[:maxContent]
			rec.Truncated = true
		}
		// ⚠️ 单条写失败**不能**提前 return：配额已经按整轮扣过了，中途退出正好
		// 造出"有提问没回复"的半截数据 —— 恰恰是上面那条原子性注释要避免的东西。
		// 继续写完剩下的(w.write 在出错时会丢弃坏句柄，下一条有机会重新打开文件)，
		// 并把这一轮标记为 truncated：少了记录就得说出来，不能装作完整。
		if err := w.write(uid, date, &rec); err != nil {
			writeFailed = true
			msgWriteErrors.Add(1)
			logger.LogError(context.Background(), fmt.Sprintf("message capture write failed: %v", err))
		} else {
			msgRecordsWritten.Add(1)
		}
		seq++
	}

	// 游标推进到新的链尾(含 assistant 回复)，供下一轮续接。
	//
	// ⚠️ assistant 只有在"下一轮请求回显它时解析器还认得出来"的前提下才能进链：
	// 推理模型常常 content 为空、内容全在 reasoning_content 里，而请求侧解析器
	// (parseOpenAIRequest)会把无文本无工具的消息整条跳过。把这种消息算进链哈希，
	// 下一轮就永远对不上，于是每轮都当新会话重放整段历史。
	all := make([]parsedMessage, 0, len(reqMsgs)+1)
	all = append(all, reqMsgs...)
	if assistant != nil && chainVisible(*assistant) {
		all = append(all, *assistant)
	}
	commitSession(task.UserId, cid, all, seq, matchedChain)

	if err := model.UpsertConversationIndex(cid, uid, date, task.Ts, task.Model, len(pending), replayDropped || writeFailed); err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("message capture index upsert failed: %v", err))
	}
}

// chainVisible 判断一条消息在下一轮请求里是否还会被解析出来。
//
// 判据直接对应 parseOpenAIRequest 的跳过条件(无文本、无 tool_calls、无 tool_call_id)。
// 对 Claude 是**偏保守**的：parseClaudeRequest 的跳过条件里没有 ToolId 一项
// (Claude 的 tool_result 由 extractClaudeToolResults 单独产出)，所以这里只会
// 多留、不会少留 —— 而链断的方向是"这里留了、解析器丢了"，保守侧是安全的。
//
// ⚠️ 改动请求侧解析器的跳过条件时必须同步改这里，两边不同步会话链就会断。
func chainVisible(pm parsedMessage) bool {
	return pm.Text != "" || pm.ToolCalls != "" || pm.ToolId != ""
}

// ── 文件写入 ────────────────────────────────────────────────────────────

type msgFile struct {
	f    *os.File
	w    *bufio.Writer
	path string
	date string
	// lastUsed 供超出 maxOpenFiles 时挑最久没写的那个淘汰。
	lastUsed time.Time
}

// maxOpenFiles 同时打开的句柄上限。
// 正常情况下 flushAll 每 2 秒就会关掉非当天的句柄，活跃用户数远够不着这个数；
// 这是防"短时间涌入大量用户把 fd 打爆"的兜底 —— 一旦触到 RLIMIT_NOFILE，
// 崩的不只是记录模块，上游连接和数据库句柄会一起失败。
const maxOpenFiles = 256

// msgWriter 持有打开的文件句柄。
//
// ⚠️ 句柄必须主动回收：key 是 uid+date，跨天后旧 key 再也不会被写到，
// 没有淘汰逻辑的话每个活跃用户每天泄漏一个 fd，且永不回落。
type msgWriter struct {
	files map[string]*msgFile
}

func newMsgWriter() *msgWriter {
	return &msgWriter{
		files: map[string]*msgFile{},
	}
}

// drop 关闭并移除一个句柄。下次写到同一个 key 会自动重新打开文件(O_APPEND，不丢已写内容)。
func (m *msgWriter) drop(key string, mf *msgFile) {
	_ = mf.f.Close()
	delete(m.files, key)
}

// evictLRU 在句柄数触顶时关掉最久未写的那个。
func (m *msgWriter) evictLRU() {
	var oldestKey string
	var oldest *msgFile
	for k, mf := range m.files {
		if oldest == nil || mf.lastUsed.Before(oldest.lastUsed) {
			oldestKey, oldest = k, mf
		}
	}
	if oldest == nil {
		return
	}
	_ = oldest.w.Flush()
	m.drop(oldestKey, oldest)
}

// MsgFileName 生成 "YYYY-MM-DD.jsonl"。
//
// 文件名只含日期：uid 已经由所在目录表达，日期由文件名表达，没有第三个维度。
//
// ⚠️ 不带节点标识意味着**同一份存储不能被多个实例同时写** —— 多进程并发
// O_APPEND 写同一文件会让行交错撕裂。当前是单节点部署，各节点独立文件系统下
// 也安全(各写各的)。若将来改为多实例共享存储(NFS/EFS)，必须重新引入节点维度，
// 或改由单一实例负责落盘。
func MsgFileName(date string) string {
	return date + ".jsonl"
}

// ParseMsgFileName 从文件名反解出日期；不符合规则时 ok=false。
// TTL 清理按文件名里的日期判定该不该删，必须走这里，不要在调用方手写切分。
func ParseMsgFileName(name string) (date string, ok bool) {
	if !strings.HasSuffix(name, ".jsonl") {
		return "", false
	}
	date = strings.TrimSuffix(name, ".jsonl")
	if len(date) != len("2006-01-02") {
		return "", false
	}
	for i, r := range date {
		if i == 4 || i == 7 {
			if r != '-' {
				return "", false
			}
			continue
		}
		if r < '0' || r > '9' {
			return "", false
		}
	}
	return date, true
}

func (m *msgWriter) path(uid string, date string) string {
	dir := operation_setting.GetMessageCaptureSetting().Dir
	if dir == "" {
		dir = "messages"
	}
	return filepath.Join(dir, uid, MsgFileName(date))
}

// write 追加一行 JSONL。
//
// ⚠️ 任何写失败都必须丢弃句柄：bufio.Writer 的错误是**粘滞**的 —— 首次失败后
// b.err 被记住，之后每次 Write/Flush 都直接返回同一个错误、根本不会碰到 OS。
// 不丢弃的话，一次瞬时 ENOSPC 就能让这个用户当天的文件在整个进程生命周期内
// 再也写不进任何东西，只能靠重启恢复。
func (m *msgWriter) write(uid string, date string, rec *MsgRecord) error {
	key := uid + "/" + date
	mf, ok := m.files[key]
	if !ok {
		if len(m.files) >= maxOpenFiles {
			m.evictLRU()
		}
		p := m.path(uid, date)
		if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
			return err
		}
		f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o640)
		if err != nil {
			return err
		}
		mf = &msgFile{f: f, w: bufio.NewWriterSize(f, 32<<10), path: p, date: date}
		m.files[key] = mf
	}
	mf.lastUsed = time.Now()

	line, err := common.Marshal(rec)
	if err != nil {
		return err
	}
	if _, err := mf.w.Write(line); err != nil {
		m.drop(key, mf)
		return err
	}
	if err := mf.w.WriteByte('\n'); err != nil {
		m.drop(key, mf)
		return err
	}
	return nil
}

// flushAll 落盘缓冲，并回收不该再留着的句柄：
//
//  1. flush 失败 —— bufio 的错误是粘滞的，留着它等于这个文件永久写不进(见 write 注释)。
//  2. 已跨天 —— key 含日期，旧日期再也不会被写到。不关就是每用户每天泄漏一个 fd。
//  3. 文件被外部删除 —— 句柄一旦打开，即使文件被 rm 掉，写入仍然"成功"：
//     数据进了已 unlink 的孤儿 inode，永远不会再出现在文件系统里，且**没有任何报错**。
//     清理脚本、日志轮转、误删都会触发。
//
// 三种情况都只是丢弃句柄，下次写入自动重新打开(O_APPEND，已有内容不受影响)。
// 每 2 秒 N 次 stat(N = 当天活跃用户数)，这个量级下开销可忽略。
func (m *msgWriter) flushAll() {
	today := model.DateOf(time.Now().Unix())
	for key, mf := range m.files {
		if err := mf.w.Flush(); err != nil {
			msgWriteErrors.Add(1)
			m.drop(key, mf)
			continue
		}
		if mf.date != today {
			m.drop(key, mf)
			continue
		}
		if _, err := os.Stat(mf.path); os.IsNotExist(err) {
			logger.LogWarn(context.Background(),
				fmt.Sprintf("message capture file disappeared, reopening: %s", mf.path))
			m.drop(key, mf)
		}
	}
}

// closeAll 在写协程退出前把所有缓冲落盘并关闭句柄。
// 这是优雅退出链路的最后一环：flush 失败必须计数，否则"重启丢数据"依旧是静默的。
func (m *msgWriter) closeAll() {
	for key, mf := range m.files {
		if err := mf.w.Flush(); err != nil {
			msgWriteErrors.Add(1)
			logger.LogError(context.Background(),
				fmt.Sprintf("message capture final flush failed: %s: %v", mf.path, err))
		}
		m.drop(key, mf)
	}
}
