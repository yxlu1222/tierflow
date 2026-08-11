package service

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"
)

// 配额语义：累计到达上限即停止，未达上限继续放行，且**任何情况下不得超过上限**。
func TestQuotaNeverExceedsLimit(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()
	s.QuotaPerDay = 10

	const date = "2026-08-03"
	granted := 0

	// 模拟一段多轮对话：首轮 3 条(system+user+assistant)，之后每轮 2 条
	steps := []int{3, 2, 2, 2, 2, 2, 2}
	accepted := []bool{}
	for _, n := range steps {
		ok := tryConsumeQuota(1, date, n)
		accepted = append(accepted, ok)
		if ok {
			granted += n
		}
	}

	// 3+2+2+2 = 9 放行；第 5 轮需 2 但只剩 1 → 拒绝；之后同样拒绝
	want := []bool{true, true, true, true, false, false, false}
	for i := range want {
		if accepted[i] != want[i] {
			t.Fatalf("第 %d 轮期望 %v，实际 %v（累计 %d）", i+1, want[i], accepted[i], granted)
		}
	}
	if granted != 9 {
		t.Fatalf("累计放行 %d 条，期望 9", granted)
	}
	if granted > s.QuotaPerDay {
		t.Fatalf("放行 %d 条超过上限 %d", granted, s.QuotaPerDay)
	}
}

// 剩余额度恰好等于所需条数时必须放行 —— 边界不能差一。
func TestQuotaExactFit(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()
	s.QuotaPerDay = 5

	const date = "2026-08-03"
	if !tryConsumeQuota(1, date, 3) {
		t.Fatal("首次 3 条应放行")
	}
	if !tryConsumeQuota(1, date, 2) { // 剩 2，恰好用完
		t.Fatal("剩余恰好等于所需时应放行")
	}
	if tryConsumeQuota(1, date, 1) {
		t.Fatal("已用满，任何请求都应拒绝")
	}
}

// 配额按 (用户, 日期) 独立计数：换用户或跨天都应重新开始。
func TestQuotaScopedByUserAndDate(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()
	s.QuotaPerDay = 3

	if !tryConsumeQuota(1, "2026-08-03", 3) {
		t.Fatal("用户1 第一天应放行")
	}
	if tryConsumeQuota(1, "2026-08-03", 1) {
		t.Fatal("用户1 第一天已满")
	}
	if !tryConsumeQuota(2, "2026-08-03", 3) {
		t.Fatal("用户2 应有独立配额")
	}
	if !tryConsumeQuota(1, "2026-08-04", 3) {
		t.Fatal("用户1 次日配额应重置")
	}
}

// 单条请求需要的条数就超过总配额时，直接拒绝而不是记一半。
func TestQuotaRejectsOversizedRequest(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()
	s.QuotaPerDay = 5

	if tryConsumeQuota(1, "2026-08-03", 12) {
		t.Fatal("单请求需求超过总配额时应拒绝")
	}
	// 拒绝不应消耗任何额度，后续小请求仍能放行
	if !tryConsumeQuota(1, "2026-08-03", 5) {
		t.Fatal("被拒绝的请求不应扣减额度")
	}
}

func TestQuotaDisabledWhenLimitNonPositive(t *testing.T) {
	common.RedisEnabled = false
	resetLocalQuotaForTest()
	s := operation_setting.GetMessageCaptureSetting()
	old := s.QuotaPerDay
	defer func() { s.QuotaPerDay = old }()

	s.QuotaPerDay = 0
	if tryConsumeQuota(1, "2026-08-03", 1) {
		t.Fatal("配额为 0 时不应记录任何消息")
	}
	s.QuotaPerDay = -1
	if tryConsumeQuota(1, "2026-08-03", 1) {
		t.Fatal("配额为负时不应记录任何消息")
	}
}
