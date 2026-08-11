package service

// MsgTask 是热路径交给异步管道的快照。
//
// ⚠️ 这里的每个字段都必须是**值拷贝**：gin.Context 在请求返回后会被 Gin 复用，
// 异步协程持有它会读到别的请求的数据。ReqBody/RespBody 同理不入 sync.Pool。
type MsgTask struct {
	UserId      int
	TokenId     int
	RequestId   string
	Endpoint    string
	RelayFormat string
	Model       string
	Status      int
	Ts          int64

	PromptTokens     int
	CompletionTokens int

	ReqBody  []byte // 请求结束前同步拷出的副本(BodyStorage 随后即被销毁)
	RespBody []byte // tee 抄下的响应字节
	// RespEncoding 上游透传下来的 Content-Encoding。网关自身不压缩响应，
	// 但 service.ShouldCopyUpstreamHeader 会把上游的该头原样复制给客户端。
	RespEncoding string
	// ErrType 该轮请求的错误类型；非空时挂到最后一条 user 消息的 err 字段上。
	ErrType string
	// RespTruncated 响应字节量超过 MaxTeeBytes、tee 提前停止抄写。
	//
	// ⚠️ 必须传到落盘记录的 truncated 上：不完整却不标记等于数据在撒谎，
	// 分析时会把半截回复当成完整回复。这比丢掉整条更糟。
	RespTruncated bool
}

// MsgRecord 是落盘 JSONL 的一行 —— 一条消息。
//
// 字段设计原则：能用 req_id 回查 logs 表拿到的一律不重复存
// (username/token_name/channel_id/quota/use_time/ip/group 等都在 logs 里)。
// 例外是 user_id 和 model：冗余一份，让文件脱离 logs 也能独立分析。
type MsgRecord struct {
	V    int    `json:"v"`
	Cid  string `json:"cid"`
	Seq  int    `json:"seq"`
	Role string `json:"role"`
	Ts   int64  `json:"ts"`
	// Uid 是**对外用户标识**(12 位数字)，不是内部自增 id。
	// 落盘数据属于对外资产，内部自增 id 不应出现在里面(见 model.User.Uid 注释)。
	// 取不到 uid 的记录直接丢弃，不退回内部 id。
	Uid   string `json:"uid"`
	ReqId string `json:"req_id"`
	// Text 必填，即使为空串也保留 —— 省略它会让"无文本"与"字段缺失"无法区分。
	Text string `json:"text"`

	Model     string `json:"model,omitempty"`
	Tokens    int    `json:"tokens,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
	// Media 被剥离的图片/音频块数量(只记数量，不记内容)。
	Media int `json:"media,omitempty"`
	// Finish finish_reason，仅 assistant。
	Finish string `json:"finish,omitempty"`
	// ToolCalls tool_calls 数组的 JSON 字符串，单独成字段不混进 Text，
	// 避免文本分析被 JSON 污染。
	ToolCalls string `json:"tool_calls,omitempty"`
	// Reasoning 推理模型的思考过程(OpenAI 口径 reasoning_content / Claude 的 thinking 块)。
	// 单独成字段而不混进 Text：它是模型的中间过程、不是对话内容本身，
	// 但对画像有价值(任务复杂度的直接信号)。
	//
	// ⚠️ 必须单独抽：推理模型常常 content 为空、全部输出都在 reasoning_content 里
	// (max_tokens 被思考占满时尤其如此)，只看 content 会把整条 assistant 消息丢掉。
	Reasoning string `json:"reasoning,omitempty"`
	// ToolId 仅 role == "tool"，关联回发起它的 assistant 消息。
	ToolId string `json:"tool_id,omitempty"`
	// Err 该轮请求失败时的错误类型，挂在最后一条 user 消息上 ——
	// assistant 消息不存在就不该伪造一条。
	Err string `json:"err,omitempty"`
}

// MsgFormatVersion 当前 JSONL 行格式版本。
// 加可选字段不升版本(旧解析器忽略未知字段即可)；
// 改语义/删字段/改类型才升，解析器按 v 分支。
const MsgFormatVersion = 1

const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
	RoleTool      = "tool"
)

// parsedMessage 是从请求/响应里抽出来的中间结构，尚未分配 cid/seq。
type parsedMessage struct {
	Role      string
	Text      string
	Media     int
	ToolCalls string
	Reasoning string
	ToolId    string
	Finish    string
	Tokens    int
	Truncated bool
	// Err 请求失败时挂在最后一条 user 消息上，见 MsgRecord.Err。
	// ⚠️ 不参与链哈希计算 —— 它是这一轮的元信息，不是消息内容的一部分，
	// 否则下一轮请求重发同样的历史时前缀会对不上，会话被误切成两段。
	Err string
}
