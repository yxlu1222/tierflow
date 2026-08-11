package service

import "testing"

// 文件名只含日期：uid 由目录表达。TTL 清理按文件名里的日期判定该不该删，
// 所以解析必须严格 —— 宁可拒绝也不要误解析成某个日期。
func TestMsgFileNameRoundTrip(t *testing.T) {
	for _, date := range []string{"2026-08-03", "2026-12-31", "2026-01-01"} {
		got, ok := ParseMsgFileName(MsgFileName(date))
		if !ok || got != date {
			t.Fatalf("%s 往返失败：got=%q ok=%v", date, got, ok)
		}
	}
}

func TestParseMsgFileNameRejectsBadInput(t *testing.T) {
	bad := []string{
		"2026-08-03@node.jsonl",            // 带节点标识的旧格式
		"2026-08-03-DESKTOP-DAIC9DB.jsonl", // 更早的连字符格式
		"2026-8-3.jsonl",                   // 日期不是定长 10
		"2026_08_03.jsonl",                 // 分隔符不对
		"20260803.jsonl",
		"abcd-ef-gh.jsonl", // 长度对但不是数字
		"2026-08-03.txt",   // 扩展名不对
		"2026-08-03",       // 没有扩展名
		"",
	}
	for _, name := range bad {
		if got, ok := ParseMsgFileName(name); ok {
			t.Fatalf("%q 应当被拒绝，却解析成 %q", name, got)
		}
	}
}
