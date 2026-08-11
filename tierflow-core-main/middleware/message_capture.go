package middleware

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/service"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
	"github.com/Zer0Echo/tierflow-core/types"

	"github.com/gin-gonic/gin"
)

// MessageCapture 记录用户对话消息。
//
// 热路径只做三件事：端点判定(纳秒级) → tee 响应字节(memcopy) →
// 请求结束时拷贝请求体 + 快照 + 非阻塞投递。
// 解析 JSON、算哈希、查 Redis、写磁盘全部在异步管道里(service/message_store.go)。
//
// ⚠️ 注册位置必须在 BodyStorageCleanup **之后** —— Gin 的 c.Next() 后置代码
// 按注册顺序反向执行，注册在后面才能在 BodyStorage 被销毁前读到它。
func MessageCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		setting := operation_setting.GetMessageCaptureSetting()
		if !setting.Enabled || !shouldCaptureEndpoint(c.Request) {
			c.Next()
			return
		}

		maxTee := setting.MaxTeeBytes
		if maxTee <= 0 {
			maxTee = 131072
		}
		tw := &teeWriter{ResponseWriter: c.Writer, limit: maxTee}
		c.Writer = tw

		start := time.Now()
		c.Next()

		// ⚠️ user_id 只能在 c.Next() 之后读：TokenAuth() 注册在**路由组**上，
		// 本中间件是全局的，运行到前置段时 "id" 还没被写入。
		userId := c.GetInt("id")
		if userId <= 0 || setting.IsUserExcluded(userId) {
			return
		}

		maxReqBody := setting.MaxReqBodyBytes
		if maxReqBody <= 0 {
			maxReqBody = 10485760
		}
		reqBody, reqOverflow := copyRequestBody(c, maxReqBody)
		if reqOverflow {
			// 截断的请求体必然是非法 JSON，喂给解析器只会得到一个 parse 错误。
			// 与其伪装成"解析失败"，不如单独计数 —— 这是配置问题，不是数据问题。
			service.CountMsgReqTooLarge()
			return
		}
		if len(reqBody) == 0 {
			return
		}

		task := &service.MsgTask{
			UserId:           userId,
			TokenId:          c.GetInt("token_id"),
			RequestId:        c.GetString(common.RequestIdKey),
			Endpoint:         c.Request.URL.Path,
			RelayFormat:      relayFormatOf(c.Request.URL.Path),
			Model:            resolveModelName(c),
			Status:           c.Writer.Status(),
			Ts:               start.Unix(),
			PromptTokens:     c.GetInt("prompt_tokens"),
			CompletionTokens: c.GetInt("completion_tokens"),
			ReqBody:          reqBody,
			RespBody:         tw.buf.Bytes(),
			RespEncoding:     c.Writer.Header().Get("Content-Encoding"),
			ErrType:          errTypeOf(c.Writer.Status()),
			RespTruncated:    tw.overflow,
		}
		service.SubmitMsgTask(task)
	}
}

// ── tee writer ──────────────────────────────────────────────────────────

// teeWriter 旁路抄走写给客户端的响应字节。
//
// ⚠️ 必须**嵌入 gin.ResponseWriter 接口**、只覆盖 Write/WriteString：
// Flush/Hijack/CloseNotify/Pusher 由嵌入自动转发。若自己声明方法集而漏掉
// Flush()，relay/helper 的 FlushWriter 拿不到 http.Flusher，SSE 会立刻卡死。
type teeWriter struct {
	gin.ResponseWriter
	buf      bytes.Buffer
	limit    int
	overflow bool
}

func (w *teeWriter) Write(b []byte) (int, error) {
	w.tee(b)
	return w.ResponseWriter.Write(b)
}

func (w *teeWriter) WriteString(s string) (int, error) {
	w.tee([]byte(s))
	return w.ResponseWriter.WriteString(s)
}

func (w *teeWriter) tee(b []byte) {
	if w.overflow {
		return
	}
	remain := w.limit - w.buf.Len()
	if remain <= 0 {
		w.overflow = true
		return
	}
	if len(b) > remain {
		w.buf.Write(b[:remain])
		w.overflow = true
		return
	}
	w.buf.Write(b)
}

// ── 采集范围判定 ────────────────────────────────────────────────────────

// shouldCaptureEndpoint 只放行文本类端点。
//
// ⚠️ Gemini 走通配路由 /v1beta/models/*path，同一条路由同时承载
// :generateContent(要采) 和 :embedContent(不采)。按路径前缀做白名单
// 会把 embedding 一起收进来，必须看 action 后缀。
func shouldCaptureEndpoint(r *http.Request) bool {
	if r == nil || r.Method != http.MethodPost {
		return false
	}
	p := r.URL.Path
	switch p {
	case "/v1/chat/completions", "/v1/messages", "/v1/completions", "/v1/responses":
		return true
	}
	if strings.HasPrefix(p, "/v1beta/models/") || strings.HasPrefix(p, "/v1/models/") {
		idx := strings.LastIndex(p, ":")
		if idx < 0 {
			return false
		}
		switch p[idx+1:] {
		case "generateContent", "streamGenerateContent":
			return true
		}
	}
	return false
}

func relayFormatOf(path string) string {
	switch {
	case path == "/v1/messages":
		return string(types.RelayFormatClaude)
	case path == "/v1/responses":
		return string(types.RelayFormatOpenAIResponses)
	case strings.HasPrefix(path, "/v1beta/models/"):
		return string(types.RelayFormatGemini)
	default:
		return string(types.RelayFormatOpenAI)
	}
}

// ── 辅助 ────────────────────────────────────────────────────────────────

// copyRequestBody 同步拷出带上限的请求体副本。
// 第二个返回值为 true 表示请求体超过 limit —— 此时返回的字节是**截断的、不可解析的**，
// 调用方必须整条放弃，绝不能拿去解析。
//
// ⚠️ 必须同步：middleware/body_cleanup.go 在请求结束时会关闭 BodyStorage、
// 删除磁盘临时文件，异步协程里再读就是读已释放状态。但"拷贝"只是 memcopy，
// 不涉及解析 —— 解析在异步管道里做。
func copyRequestBody(c *gin.Context, limit int) ([]byte, bool) {
	storage, err := common.GetBodyStorage(c)
	if err != nil || storage == nil {
		return nil, false
	}
	if _, err := storage.Seek(0, io.SeekStart); err != nil {
		return nil, false
	}
	buf := make([]byte, 0, 4096)
	out := bytes.NewBuffer(buf)
	// 多读 1 字节用来区分"正好等于上限"和"超过上限"，否则两者无法分辨。
	if _, err := io.Copy(out, io.LimitReader(storage, int64(limit)+1)); err != nil {
		return nil, false
	}
	if out.Len() > limit {
		return nil, true
	}
	return out.Bytes(), false
}

func resolveModelName(c *gin.Context) string {
	if v := c.GetString(string(constant.ContextKeyOriginalModel)); v != "" {
		return v
	}
	if v := c.GetString("original_model"); v != "" {
		return v
	}
	return c.GetString("request_model")
}

func errTypeOf(status int) string {
	switch {
	case status == 429:
		return "rate_limited"
	case status >= 500:
		return "upstream_error"
	case status >= 400:
		return "client_error"
	default:
		return ""
	}
}
