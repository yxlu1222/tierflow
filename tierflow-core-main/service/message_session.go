package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
)

// ── 链式前缀哈希 ────────────────────────────────────────────────────────
//
// API 请求里没有 conversation_id。第 N+1 次请求的消息前缀，正好等于
// 第 N 次请求的全部消息加上第 N 次的回复 —— 靠这个前缀关系把多次请求串成会话。
//
//	h₀ = ""
//	hᵢ = sha256(hᵢ₋₁ + "\n" + roleᵢ + "\n" + sha256(contentᵢ))

func chainStep(prev string, role string, text string) string {
	inner := sha256.Sum256([]byte(text))
	outer := sha256.Sum256([]byte(prev + "\n" + role + "\n" + hex.EncodeToString(inner[:])))
	return hex.EncodeToString(outer[:16])
}

// chainHashes 返回消息序列每个前缀的链哈希，chain[i] 覆盖 msgs[0..i]。
func chainHashes(msgs []parsedMessage) []string {
	out := make([]string, len(msgs))
	prev := ""
	for i, m := range msgs {
		prev = chainStep(prev, m.Role, m.Text)
		out[i] = prev
	}
	return out
}

// ── 会话游标 ────────────────────────────────────────────────────────────

type sessionCursor struct {
	Cid string `json:"cid"`
	Seq int    `json:"seq"` // 下一条消息应使用的 seq
}

const sessionCursorTTL = 24 * time.Hour

// 进程内降级存储：Redis 不可用时使用。
// 10 个用户的量级完全够用；多节点部署下会把同一会话切成几段，消息不丢。
var (
	localCursorMu sync.Mutex
	localCursors  = map[string]localCursorEntry{}
)

type localCursorEntry struct {
	cursor    sessionCursor
	expiresAt time.Time
}

func cursorKey(userId int, chain string) string {
	return fmt.Sprintf("chain:%d:%s", userId, chain)
}

func loadCursor(userId int, chain string) (sessionCursor, bool) {
	key := cursorKey(userId, chain)
	if common.RedisEnabled {
		val, err := common.RedisGet(key)
		if err == nil && val != "" {
			var c sessionCursor
			if err := common.UnmarshalJsonStr(val, &c); err == nil {
				return c, true
			}
		}
		return sessionCursor{}, false
	}

	localCursorMu.Lock()
	defer localCursorMu.Unlock()
	entry, ok := localCursors[key]
	if !ok || time.Now().After(entry.expiresAt) {
		delete(localCursors, key)
		return sessionCursor{}, false
	}
	return entry.cursor, true
}

func saveCursor(userId int, chain string, c sessionCursor) {
	key := cursorKey(userId, chain)
	if common.RedisEnabled {
		if b, err := common.Marshal(c); err == nil {
			_ = common.RedisSet(key, string(b), sessionCursorTTL)
		}
		return
	}

	localCursorMu.Lock()
	defer localCursorMu.Unlock()
	// 顺手清理过期项，避免长期运行时无界增长
	if len(localCursors) > 4096 {
		now := time.Now()
		for k, v := range localCursors {
			if now.After(v.expiresAt) {
				delete(localCursors, k)
			}
		}
	}
	localCursors[key] = localCursorEntry{cursor: c, expiresAt: time.Now().Add(sessionCursorTTL)}
}

// deleteCursor 作废一个已被消费的链游标，见 commitSession 的说明。
func deleteCursor(userId int, chain string) {
	key := cursorKey(userId, chain)
	if common.RedisEnabled {
		_ = common.RedisDel(key)
		return
	}
	localCursorMu.Lock()
	defer localCursorMu.Unlock()
	delete(localCursors, key)
}

// resolveSession 判定本次请求属于哪个会话，以及其中哪些消息是新增的。
//
// 返回 cid、新消息应起始的 seq、新增消息的切片(reqMsgs 的尾部)，
// 以及命中的那个前缀链哈希(未命中为空串)—— 后者交给 commitSession 在游标
// 前移成功后删除，见下面对"前缀撞车"的说明。
func resolveSession(userId int, reqMsgs []parsedMessage) (cid string, startSeq int, fresh []parsedMessage, matchedChain string) {
	if len(reqMsgs) == 0 {
		return "", 0, nil, ""
	}
	chains := chainHashes(reqMsgs)

	// 从最长前缀往回找：优先匹配"只差最后一条"的情形(最常见的多轮延续)，
	// 找不到再逐步缩短。这样客户端偶尔多发/少发一条也能续上会话。
	for i := len(reqMsgs) - 2; i >= 0; i-- {
		if c, ok := loadCursor(userId, chains[i]); ok {
			return c.Cid, c.Seq, reqMsgs[i+1:], chains[i]
		}
	}

	// 未命中 —— 新会话，全部消息都是新的
	return newConversationId(), 0, reqMsgs, ""
}

// commitSession 把会话游标推进到新的链尾(含 assistant 回复)，并作废刚被消费掉的旧游标。
//
// ⚠️ 删除必须放在这里、不能放在 resolveSession：配额不足等路径会在落盘前提前返回，
// 那时游标还得留着，否则下一轮会话直接断掉。
//
// ⚠️ 已知残留问题：链哈希只由请求字节算出，两段**开头完全相同**的会话
// (同一 system prompt + 同一句开场白，例如同时开两个标签页)会算出相同的前缀哈希。
// 若会话 B 的第二轮请求赶在会话 A 前移之前到达，B 仍会命中 A 的游标而被并进 A 的 cid。
// 删除游标只能挡住"已被消费的游标再被第二段会话捡走"这一类，无法彻底消除歧义 ——
// 从请求字节里根本区分不出这是同一段会话的续写还是另一段同开头的会话。
// 要根治只能引入客户端传入的会话标识。
func commitSession(userId int, cid string, allMsgs []parsedMessage, nextSeq int, consumedChain string) {
	if len(allMsgs) == 0 {
		return
	}
	chains := chainHashes(allMsgs)
	tail := chains[len(chains)-1]
	saveCursor(userId, tail, sessionCursor{Cid: cid, Seq: nextSeq})
	if consumedChain != "" && consumedChain != tail {
		deleteCursor(userId, consumedChain)
	}
}

func newConversationId() string {
	return "c_" + common.GetRandomString(12)
}

// ── 配额 ────────────────────────────────────────────────────────────────

var (
	localQuotaMu sync.Mutex
	localQuotas  = map[string]int{}
)

func quotaKey(userId int, date string) string {
	return fmt.Sprintf("msgquota:%d:%s", userId, date)
}

// tryConsumeQuota 按请求原子判定：剩余配额 >= n 才全部落盘，否则整个请求跳过。
//
// 这样避免"user 问题记下了、assistant 回复没记"的半截数据。副作用是可能
// 剩 1 条配额一直用不掉 —— 最多浪费 1~2 条，换来任何已落盘的会话片段都是完整的。
//
// ⚠️ Redis 分支必须是"先 IncrBy、超了再 DecrBy 退回"，不能写成 Get-then-IncrBy：
//   - Get 失败(读超时等)与 key 不存在无法区分，一律当 0 会让上限彻底失效；
//   - 多节点共用一个 Redis 时，读写之间的窗口本身就有竞态。
//
// IncrBy 是原子的，先加再判定就不存在这两个问题；被拒时退回，净效果为零。
func tryConsumeQuota(userId int, date string, n int) bool {
	if n <= 0 {
		return false
	}
	limit := operation_setting.GetMessageCaptureSetting().QuotaPerDay
	if limit <= 0 {
		return false
	}
	key := quotaKey(userId, date)

	if common.RedisEnabled {
		ctx := context.Background()
		newVal, err := common.RDB.IncrBy(ctx, key, int64(n)).Result()
		if err != nil {
			return false
		}
		// 过期必须在超限判定**之前**设：否则被拒的那次若正好创建了 key，
		// DecrBy 退回 0 后会留下一个没有 TTL 的永久 key。
		if newVal == int64(n) {
			_ = common.RDB.Expire(ctx, key, 48*time.Hour).Err()
		}
		if newVal > int64(limit) {
			_ = common.RDB.DecrBy(ctx, key, int64(n)).Err()
			return false
		}
		return true
	}

	localQuotaMu.Lock()
	defer localQuotaMu.Unlock()
	// 顺手清理其它日期的计数，避免长期运行时按天无界增长
	if len(localQuotas) > 4096 {
		suffix := ":" + date
		for k := range localQuotas {
			if !strings.HasSuffix(k, suffix) {
				delete(localQuotas, k)
			}
		}
	}
	if localQuotas[key]+n > limit {
		return false
	}
	localQuotas[key] += n
	return true
}

// resetLocalQuotaForTest 仅供测试使用。
func resetLocalQuotaForTest() {
	localQuotaMu.Lock()
	localQuotas = map[string]int{}
	localQuotaMu.Unlock()

	localCursorMu.Lock()
	localCursors = map[string]localCursorEntry{}
	localCursorMu.Unlock()
}
