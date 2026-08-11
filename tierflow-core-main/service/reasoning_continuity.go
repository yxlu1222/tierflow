package service

// TierFlow: reasoning 连续性兜底。
//
// 背景：按步路由会让一段对话的 assistant 历史是【多个模型】输出的混合。部分推理模型
// (如官方 DeepSeek 思考模式 + 工具调用)在多轮里要求 assistant 历史带回它的 reasoning_content，
// 否则 400("The reasoning_content in the thinking mode must be passed back to the API.")。
// 而跨模型(上一轮是别的模型)或客户端(Codex 等不认识该非 OpenAI 字段、会剥掉)场景下，该字段缺失。
//
// 方案：对 DeepSeek 渠道类型下的思考模型，转发前确保【发生过工具调用的对话】里
// 每条 assistant 消息都带 reasoning_content —— 命中哈希缓存(本模型此前真实生成过)则回填
// 【真实】草稿(零损失)，未命中则补【占位】(满足上游要求；跨模型场景本无真实草稿可丢，质量无实际损失)。
// 完全没有工具调用的纯对话历史不碰(判定见 conversationHasToolCall)。缓存按用户+模型分域。
// 全程不改路由结果，按步切换完全保留。

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/dto"
	"github.com/Zer0Echo/tierflow-core/pkg/cachex"

	"github.com/samber/hot"
)

const (
	reasoningContinuityNamespace = "new-api:reasoning_continuity:v1"
	// 占位 reasoning：满足"必须带 reasoning_content"的上游要求；内容不参与模型实际推理。
	reasoningPlaceholder     = "(omitted)"
	reasoningCacheTTLSeconds  = 1800
	reasoningCacheCapacity    = 50000
)

var (
	reasoningCacheOnce sync.Once
	reasoningCache     *cachex.HybridCache[string]
)

func getReasoningCache() *cachex.HybridCache[string] {
	reasoningCacheOnce.Do(func() {
		reasoningCache = cachex.NewHybridCache[string](cachex.HybridCacheConfig[string]{
			Namespace: cachex.Namespace(reasoningContinuityNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.StringCodec{},
			Memory: func() *hot.HotCache[string, string] {
				return hot.NewHotCache[string, string](hot.LRU, reasoningCacheCapacity).
					WithTTL(reasoningCacheTTLSeconds * time.Second).
					WithJanitor().
					Build()
			},
		})
	})
	return reasoningCache
}

// reasoningScope 把缓存条目限定到「同一用户 + 同一上游模型」。
//
// 【安全关键】key 里必须带用户维度。缓存命名空间是进程级的，开了 Redis 还跨实例共享；
// 只按消息内容哈希的话，两个用户发出内容完全相同的 assistant 消息(短回复如 "好的。" 极易撞)
// 就会共用一条缓存 —— A 的私有思考链会被当作 B 的历史草稿注入 B 发往上游的请求。
// 模型维度同样要带：不同模型的思考链互相冒名顶替没有意义。
type reasoningScope struct {
	userID int
	model  string
}

func newReasoningScope(userID int, modelName string) reasoningScope {
	return reasoningScope{userID: userID, model: strings.ToLower(modelName)}
}

// reasoningKey 由 作用域 + assistant 消息的 content + tool_calls 生成稳定哈希。
// 客户端回传该 assistant 消息时后两部分不变，故缓存(写入时用响应)与回填(读取时用请求)能对上。
//
// tool_calls 不直接哈希原始字节：写入侧(响应/流式重组)与读取侧(客户端回传)对同一组工具调用的
// JSON 序列化常有差异(空白、键序、流式分片重组)，原始字节比对几乎必然 miss。改为提取
// (id, name, arguments) 归一化摘要后再哈希，使两侧对同一逻辑工具调用产生一致的 key，
// 真实 reasoning 的命中率因此显著提升。
func reasoningKey(scope reasoningScope, contentStr string, toolCalls []byte) string {
	h := sha256.New()
	h.Write([]byte(strconv.Itoa(scope.userID)))
	h.Write([]byte{0})
	h.Write([]byte(scope.model))
	h.Write([]byte{0})
	h.Write([]byte(contentStr))
	h.Write([]byte{0})
	h.Write([]byte(reasoningToolCallsDigest(toolCalls)))
	return hex.EncodeToString(h.Sum(nil))
}

// reasoningToolCallsDigest 把 tool_calls JSON 数组归一化为稳定摘要(按数组序拼 id\x1fname\x1fargs)。
// 请求侧与响应侧的 tool_calls 都是 [{id,type,function:{name,arguments}}] 形态，解析后摘要一致。
//
// 空数组 `[]` 必须与「没有 tool_calls」归一成同一个摘要：响应侧无工具调用时传 nil(摘要 "")，
// 而客户端回传同一条 assistant 消息时常序列化成显式的 `[]`。两侧摘要不同 ⇒ key 对不上 ⇒
// 真实草稿命中不了、静默退化成占位。只有【解析失败】才退回原始字节。
func reasoningToolCallsDigest(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var calls []struct {
		ID       string `json:"id"`
		Function struct {
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"function"`
	}
	if err := common.Unmarshal(raw, &calls); err != nil {
		return string(raw)
	}
	if len(calls) == 0 {
		return ""
	}
	var b strings.Builder
	for _, c := range calls {
		b.WriteString(c.ID)
		b.WriteByte(0x1f)
		b.WriteString(c.Function.Name)
		b.WriteByte(0x1f)
		b.WriteString(c.Function.Arguments)
		b.WriteByte(0x1e)
	}
	return b.String()
}

// deepSeekThinkingModelPrefix 是 DeepSeek 思考模式模型的名称前缀。
// 只有 V4 系列跑思考模式并要求多轮回传 reasoning_content；deepseek-chat / deepseek-reasoner
// 不在此列 —— 给它们注入 reasoning_content 反而可能被上游拒。
const deepSeekThinkingModelPrefix = "deepseek-v4"

// NeedsReasoningContinuity 判定该请求是否需要 reasoning 连续性处理。
//
// 这是【渠道类型内建】的能力，不需要管理员配置：渠道类型选了 DeepSeek(43) 就意味着上游是
// DeepSeek 协议，思考模式多轮必须回传 reasoning_content 是这家上游的协议要求，而不是站点偏好。
// 早先版本靠系统选项 ReasoningContinuityModels(逗号分隔子串)开启，默认为空 ⇒ 整条链路是死代码，
// 每个部署都要先踩一次上游 400 才会有人去开它。现改为按渠道类型自动生效。
//
// 已知取舍：把 DeepSeek 配成 ChannelTypeOpenAI 的场景(如指向聚合商的 openai 类型渠道)不再覆盖 ——
// 聚合商无法从渠道类型上识别，要覆盖就得把渠道改成 DeepSeek 类型。
func NeedsReasoningContinuity(channelType int, modelName string) bool {
	if channelType != constant.ChannelTypeDeepSeek {
		return false
	}
	return strings.HasPrefix(strings.ToLower(modelName), deepSeekThinkingModelPrefix)
}

// RememberReasoning 缓存推理模型本轮生成的【真实】reasoning_content，按 用户+模型+content+tool_calls
// 哈希为键，供后续轮(客户端回传时已剥掉 reasoning)按哈希回填真实草稿，实现同用户同模型零损失。
func RememberReasoning(userID int, modelName, contentStr string, toolCalls []byte, reasoning string) {
	if reasoning == "" || (contentStr == "" && reasoningToolCallsDigest(toolCalls) == "") {
		return
	}
	scope := newReasoningScope(userID, modelName)
	_ = getReasoningCache().SetWithTTL(reasoningKey(scope, contentStr, toolCalls), reasoning, reasoningCacheTTLSeconds*time.Second)
}

func lookupReasoning(scope reasoningScope, contentStr string, toolCalls []byte) (string, bool) {
	v, found, err := getReasoningCache().Get(reasoningKey(scope, contentStr, toolCalls))
	if err != nil || !found || v == "" {
		return "", false
	}
	return v, true
}

// ApplyReasoningContinuity 是转发前的处理入口：给 assistant 历史补齐 reasoning_content
// (命中缓存回填真实草稿、否则补占位)，避免上游 400 "must be passed back"。
//
// 调用方(deepseek adaptor)负责先用 NeedsReasoningContinuity 判定渠道/模型，再判定思考模式
// 是否被显式关闭 —— 关闭思考时上游不要求回传，注入反而是多余风险。
func ApplyReasoningContinuity(userID int, modelName string, messages []dto.Message) {
	real, ph := EnsureAssistantReasoning(userID, modelName, messages)
	if (real+ph) > 0 && common.DebugEnabled {
		common.SysLog(fmt.Sprintf("reasoning continuity: backfilled real=%d placeholder=%d for %s", real, ph, modelName))
	}
}

// conversationHasToolCall 判断整段历史里是否发生过工具调用。
//
// DeepSeek 文档的措辞是「两条 user 消息之间若发生过工具调用，该段 assistant 的 reasoning_content
// 必须回传；没有工具调用的轮次则不需要」。曾按 user 消息切段、只处理含工具调用的段实现，
// 但那会让「先纯聊两句、再调工具」这种极常见形状里靠前的 assistant 消息丢掉 reasoning_content——
// 文档只说那些轮次「不需要」，没说「不能带」，而上游是否真按段校验我们从未测出来。
//
// 风险不对称：漏补是硬 400，多补则【已实测被上游接受】(注入占位后请求仍 200)。
// 因此判定放宽到整段对话：只要历史里出现过工具调用，段内所有 assistant 一律补齐。
// 完全没有工具调用的纯对话历史仍然一条都不碰 —— 那是收窄的主要价值所在。
func conversationHasToolCall(messages []dto.Message) bool {
	for i := range messages {
		// ParseToolCalls 而非 len(ToolCalls)：后者对空数组 `[]` 会误判成有工具调用。
		if messages[i].Role == "assistant" && len(messages[i].ParseToolCalls()) > 0 {
			return true
		}
	}
	return false
}

// EnsureAssistantReasoning 在【发生过工具调用的对话】里给缺 reasoning_content 的 assistant 消息补齐：
// 命中哈希缓存 → 回填【真实】草稿(零损失)；未命中(跨模型/缓存过期) → 补【占位】(满足上游要求)。
// 纯对话历史不动 —— 见 conversationHasToolCall 的说明。
// 仅当目标渠道/模型需要 reasoning 连续性时调用。返回(真实回填数, 占位数)，供日志/调试。
func EnsureAssistantReasoning(userID int, modelName string, messages []dto.Message) (real, placeholder int) {
	if !conversationHasToolCall(messages) {
		return 0, 0
	}
	scope := newReasoningScope(userID, modelName)
	for i := range messages {
		m := &messages[i]
		if m.Role != "assistant" || m.GetReasoningContent() != "" {
			continue
		}
		contentStr := m.StringContent()
		// 同样用 ParseToolCalls：空数组 `[]` 的 assistant 既无内容也无工具调用，
		// 给它塞 reasoning_content 会造出一条「三无」消息，是最容易被上游拒的形状。
		if contentStr == "" && len(m.ParseToolCalls()) == 0 {
			continue
		}
		if r, ok := lookupReasoning(scope, contentStr, []byte(m.ToolCalls)); ok {
			rc := r
			m.ReasoningContent = &rc
			real++
		} else {
			ph := reasoningPlaceholder
			m.ReasoningContent = &ph
			placeholder++
		}
	}
	return real, placeholder
}

// ReasoningStreamCollector 在流式响应里按 choice 累积 content / reasoning / tool_calls，
// 流结束后把【真实】reasoning 按 hash(content+tool_calls) 缓存，使下一轮同模型回填零损失。
//
// 背景：原先只有非流式 OpenaiHandler 调 RememberReasoning，流式(Codex 等默认走流式)从不缓存，
// 真实草稿全程丢失、只能补占位。本收集器补上流式侧的缓存，与非流式同口径。
// 仅当目标模型需 reasoning 连续性时创建(NewReasoningStreamCollector 返回 nil 表示不收集)。
type ReasoningStreamCollector struct {
	userID  int    // 缓存作用域：同一用户
	model   string // 缓存作用域：同一上游模型
	choices map[int]*reasoningChoiceAcc
}

type reasoningChoiceAcc struct {
	content   strings.Builder
	reasoning strings.Builder
	tools     []*reasoningToolAcc // 按 tool_calls 数组下标累积
}

type reasoningToolAcc struct {
	id   string
	name string
	args strings.Builder
}

// NewReasoningStreamCollector 仅在该渠道/模型需 reasoning 连续性时返回非 nil 收集器。
//
// 响应侧同样按渠道类型判定：deepseek adaptor 的 DoResponse 委托给 openai adaptor 处理，
// 所以缓存写入发生在 openai 包里，但归属的渠道类型仍是 DeepSeek。
func NewReasoningStreamCollector(channelType, userID int, modelName string) *ReasoningStreamCollector {
	if !NeedsReasoningContinuity(channelType, modelName) {
		return nil
	}
	return &ReasoningStreamCollector{
		userID:  userID,
		model:   modelName,
		choices: map[int]*reasoningChoiceAcc{},
	}
}

// Add 累积一个流式分片(对 nil 收集器安全，便于调用方无脑调用)。
func (rc *ReasoningStreamCollector) Add(resp dto.ChatCompletionsStreamResponse) {
	if rc == nil {
		return
	}
	for _, ch := range resp.Choices {
		acc := rc.choices[ch.Index]
		if acc == nil {
			acc = &reasoningChoiceAcc{}
			rc.choices[ch.Index] = acc
		}
		acc.content.WriteString(ch.Delta.GetContentString())
		acc.reasoning.WriteString(ch.Delta.GetReasoningContent())
		for _, tc := range ch.Delta.ToolCalls {
			idx := 0
			if tc.Index != nil {
				idx = *tc.Index
			}
			if idx < 0 {
				idx = 0
			}
			for len(acc.tools) <= idx {
				acc.tools = append(acc.tools, &reasoningToolAcc{})
			}
			t := acc.tools[idx]
			if tc.ID != "" {
				t.id = tc.ID
			}
			if tc.Function.Name != "" {
				t.name = tc.Function.Name
			}
			t.args.WriteString(tc.Function.Arguments)
		}
	}
}

// Flush 在流结束后把各 choice 的【真实】reasoning 缓存起来(content+tool_calls 为键)。
func (rc *ReasoningStreamCollector) Flush() {
	if rc == nil {
		return
	}
	for _, acc := range rc.choices {
		reasoning := acc.reasoning.String()
		if reasoning == "" {
			continue
		}
		var toolBytes []byte
		if len(acc.tools) > 0 {
			arr := make([]map[string]any, 0, len(acc.tools))
			for _, t := range acc.tools {
				if t.id == "" && t.name == "" && t.args.Len() == 0 {
					continue
				}
				arr = append(arr, map[string]any{
					"id":   t.id,
					"type": "function",
					"function": map[string]any{
						"name":      t.name,
						"arguments": t.args.String(),
					},
				})
			}
			if len(arr) > 0 {
				if b, err := common.Marshal(arr); err == nil {
					toolBytes = b
				}
			}
		}
		RememberReasoning(rc.userID, rc.model, acc.content.String(), toolBytes, reasoning)
	}
}
