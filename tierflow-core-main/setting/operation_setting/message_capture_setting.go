package operation_setting

import (
	"strconv"
	"strings"

	"github.com/Zer0Echo/tierflow-core/setting/config"
)

// MessageCaptureSetting 用户消息记录配置。
// 设计见 docs/conversation-capture-design.md。
type MessageCaptureSetting struct {
	// Enabled 总开关，默认关闭
	Enabled bool `json:"enabled"`
	// Dir 落盘根目录。相对路径按**进程工作目录**解析：
	// Docker 镜像的 WORKDIR 是 /data(见 Dockerfile)，且 docker-compose 把宿主
	// ./data 挂到 /data，所以默认值 "messages" 在容器里落到 /data/messages
	// —— 与 SQLite 的 one-api.db 同级，天然在挂载卷内、重启不丢。
	// 本地开发时(cwd = 项目根)落到 ./messages。
	Dir string `json:"dir"`
	// QuotaPerDay 每用户每天记录的消息条数上限
	QuotaPerDay int `json:"quota_per_day"`
	// MaxContentBytes 单条正文上限，超出截断
	MaxContentBytes int `json:"max_content_bytes"`
	// MaxTeeBytes 响应 tee 缓冲上限，超出即停止抄写并标记截断。
	//
	// ⚠️ 这个值要按 **SSE 原始字节**估，不是按文本长度：流式响应每个 delta 都是
	// 一个完整 JSON 包(id/object/created/model/choices 全套元数据)，而内容往往只有
	// 一两个字 —— 实测膨胀 22~26 倍。1071 字正文 + 2187 字思考的一轮对话，
	// SSE 原始体积是 258KB。
	//
	// 因此上限必须 ≥ 26 × MaxContentBytes × 2(正文 + reasoning)，否则文本还没到
	// MaxContentBytes 就先被 tee 截断了。2MB 对应约 80KB 文本，覆盖 32KB×2 的上限仍有余量。
	MaxTeeBytes int `json:"max_tee_bytes"`
	// MaxReqBodyBytes 请求体拷贝上限。
	//
	// ⚠️ 必须与 MaxTeeBytes 分开配置：那个值是按 **SSE 响应**的膨胀倍率估的，
	// 拿来当请求体上限会把长历史请求从中间截断成非法 JSON —— 解析必然失败，
	// 整轮被当成 parse 错误丢掉，且请求体只增不减，之后每一轮都丢。
	// 超限时不截断投递，而是整条跳过并计入 dropped_req_too_large，绝不喂半截 JSON 给解析器。
	MaxReqBodyBytes int `json:"max_req_body_bytes"`
	// MaxReplayMessages 游标未命中时，单次请求最多重放多少条历史消息。
	//
	// ⚠️ 不设上限会有两个后果：一是同一段历史被反复落盘(客户端裁剪上下文、
	// 改 system prompt、游标过期、进程重启都会导致未命中)；二是 len(pending)
	// 可能直接超过 QuotaPerDay，于是该用户**永远**记不下任何东西 ——
	// 恰好是历史最长、最值得画像的重度用户被静默排除。
	// 实际生效值还会被压到 QuotaPerDay-1 以下，保证整轮永远塞得进一天的配额。
	MaxReplayMessages int `json:"max_replay_messages"`
	// QueueSize 异步队列容量，满则丢弃
	QueueSize int `json:"queue_size"`
	// ExcludeUserIds 不记录的用户 id，逗号分隔
	ExcludeUserIds string `json:"exclude_user_ids"`
}

var messageCaptureSetting = MessageCaptureSetting{
	Enabled:           false,
	Dir:               "messages",
	QuotaPerDay:       200,
	MaxContentBytes:   32768,
	MaxTeeBytes:       2097152,
	MaxReqBodyBytes:   10485760,
	MaxReplayMessages: 50,
	QueueSize:         512,
	ExcludeUserIds:    "",
}

func init() {
	config.GlobalConfig.Register("message_capture_setting", &messageCaptureSetting)
}

func GetMessageCaptureSetting() *MessageCaptureSetting {
	return &messageCaptureSetting
}

// IsUserExcluded 判断用户是否在排除名单里。
// 名单极短(手工配置)，线性扫描即可，无需缓存。
func (s *MessageCaptureSetting) IsUserExcluded(userId int) bool {
	if s.ExcludeUserIds == "" {
		return false
	}
	target := strconv.Itoa(userId)
	for _, part := range strings.Split(s.ExcludeUserIds, ",") {
		if strings.TrimSpace(part) == target {
			return true
		}
	}
	return false
}
