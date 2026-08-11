package service

// TierFlow: tool_calls id 规范化兜底。
//
// 背景：部分上游(如 aiping.cn 转售的 qwen3.5)流式 tool_calls 的【后续】分片带显式空字段
// "id":""、"function":{"name":""}（OpenAI 规范是后续分片直接省略这些字段，只发 arguments 增量）。
// 下游客户端(如 CC Switch 的 Codex 本地代理)按"字段存在即覆盖"组装时，首分片里的真实
// call_id 会被后续分片的空串覆盖；该空 id 进入客户端会话历史后，下一轮请求里
// assistant.tool_calls[].id 与 tool 消息的 tool_call_id 均为空，被严格校验的上游 400 拒绝：
//   - StepFun: "tool_calls.id and tool_calls.type are required"
//   - qwen:    "role='tool' (tool_call_id='<missing>') appears without a preceding assistant
//              message containing 'tool_calls'"
//
// 方案：双向兜底，默认开启（系统选项 ToolCallNormalizeDisabled=true 可整体关闭）：
//  1. 响应侧 ScrubStreamToolCallDelta —— 转发流式分片前用 sjson 原地删掉 tool_calls 里的
//     空 id/name/type 字段，把分片还原成 OpenAI 规范形态，防止污染下游组装器。
//     用 gjson/sjson 做手术式修改而非 dto 重序列化，保留上游扩展字段(provider 等)原样透传。
//  2. 请求侧 RepairToolCallIDs —— 对已被污染的历史(空 id / 空 tool_call_id)按顺序补
//     确定性 id，救活存量被污染会话（否则这类请求必然 400，顺序配对只会更好不会更坏）。

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/dto"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// ToolCallNormalizeDisabled 系统选项：true 时整体关闭 tool_calls 规范化（默认开启）。
func ToolCallNormalizeDisabled() bool {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["ToolCallNormalizeDisabled"]
	common.OptionMapRWMutex.RUnlock()
	return strings.EqualFold(strings.TrimSpace(raw), "true")
}

// scrubEmptyField 删除 path 处"存在但为空串/null"的字段，返回(新文档, 是否删除)。
// 删除失败时原样返回，绝不让规范化破坏数据(fail-open)。
func scrubEmptyField(doc string, path string) (string, bool) {
	v := gjson.Get(doc, path)
	if !v.Exists() {
		return doc, false
	}
	if v.Type == gjson.Null || (v.Type == gjson.String && v.String() == "") {
		if out, err := sjson.Delete(doc, path); err == nil {
			return out, true
		}
	}
	return doc, false
}

// ScrubStreamToolCallDelta 规范化一条 OpenAI 流式 chunk：
// 删除 choices[].delta.tool_calls[] 里空的 id / type / function.name 字段。
// 非法 JSON、无 tool_calls、或规范化被关闭时原样返回。
func ScrubStreamToolCallDelta(data string) string {
	if !strings.Contains(data, "tool_calls") || ToolCallNormalizeDisabled() {
		return data
	}
	if !gjson.Valid(data) {
		return data
	}
	choices := gjson.Get(data, "choices")
	if !choices.IsArray() {
		return data
	}
	out := data
	for ci, choice := range choices.Array() {
		toolCalls := choice.Get("delta.tool_calls")
		if !toolCalls.IsArray() {
			continue
		}
		for ti := range toolCalls.Array() {
			base := fmt.Sprintf("choices.%d.delta.tool_calls.%d.", ci, ti)
			out, _ = scrubEmptyField(out, base+"id")
			out, _ = scrubEmptyField(out, base+"type")
			out, _ = scrubEmptyField(out, base+"function.name")
		}
	}
	return out
}

// RepairToolCallIDs 修复请求历史里被污染的 tool_calls：
//   - assistant.tool_calls[] 缺失/空 id → 按消息位置补确定性 id "call_fix_<msgIdx>_<tcIdx>"，
//     缺失/空 type → 补 "function"；
//   - 其后 role=tool 消息缺失/空 tool_call_id → 按顺序认领最近一条 assistant 里未被
//     认领的 id（这类请求本来必 400，顺序启发式只会改善结果）。
//
// 返回修复的字段数，供日志。无需修复时不做任何序列化改动。
func RepairToolCallIDs(messages []dto.Message) int {
	if ToolCallNormalizeDisabled() {
		return 0
	}
	repaired := 0
	var lastIDs []string  // 最近一条带 tool_calls 的 assistant 的 id 顺序表
	var claimed []bool    // 上表对应 id 是否已被 tool 消息认领
	for i := range messages {
		m := &messages[i]
		switch m.Role {
		case "assistant":
			lastIDs, claimed = nil, nil
			if len(m.ToolCalls) == 0 {
				continue
			}
			raw := string(m.ToolCalls)
			toolCalls := gjson.Parse(raw)
			if !toolCalls.IsArray() {
				continue
			}
			changed := false
			for ti, tc := range toolCalls.Array() {
				id := tc.Get("id").String()
				if strings.TrimSpace(id) == "" {
					id = fmt.Sprintf("call_fix_%d_%d", i, ti)
					if out, err := sjson.Set(raw, fmt.Sprintf("%d.id", ti), id); err == nil {
						raw = out
						changed = true
						repaired++
					}
				}
				if tc.Get("type").String() == "" {
					if out, err := sjson.Set(raw, fmt.Sprintf("%d.type", ti), "function"); err == nil {
						raw = out
						changed = true
						repaired++
					}
				}
				lastIDs = append(lastIDs, id)
			}
			claimed = make([]bool, len(lastIDs))
			if changed {
				m.ToolCalls = json.RawMessage(raw)
			}
		case "tool":
			if strings.TrimSpace(m.ToolCallId) != "" {
				// 已带 id 的 tool 消息：标记对应 id 已认领，避免空 id 消息错领
				for k, id := range lastIDs {
					if !claimed[k] && id == m.ToolCallId {
						claimed[k] = true
						break
					}
				}
				continue
			}
			for k := range lastIDs {
				if !claimed[k] {
					m.ToolCallId = lastIDs[k]
					claimed[k] = true
					repaired++
					break
				}
			}
		default:
			// 其它角色(user/system/...)出现表示本轮工具循环结束，防止跨段误配
			lastIDs, claimed = nil, nil
		}
	}
	return repaired
}
