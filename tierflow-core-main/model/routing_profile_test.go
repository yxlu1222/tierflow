package model

import "testing"

func TestParseScoreBands(t *testing.T) {
	bands := parseScoreBands("0-3:5,3-5:4,5-7:3,7-9:2,9-10:1")
	if len(bands) != 5 {
		t.Fatalf("expected 5 bands, got %d", len(bands))
	}
	if bands[0].lo != 0 || bands[0].hi != 3 || bands[0].tier != 5 {
		t.Errorf("band0 wrong: %+v", bands[0])
	}
	if bands[4].lo != 9 || bands[4].hi != 10 || bands[4].tier != 1 {
		t.Errorf("band4 wrong: %+v", bands[4])
	}

	// 容错：跳过非法片段
	bands = parseScoreBands("0-3:5, junk ,3-5:x,,5-7:3")
	if len(bands) != 2 {
		t.Errorf("expected 2 valid bands from messy input, got %d (%+v)", len(bands), bands)
	}
}

func newTestProfile() *RoutingProfile {
	return &RoutingProfile{
		ScoreBands: "0-3:5,3-5:4,5-7:3,7-9:2,9-10:1",
		Tier1Model: "tier1-strong",
		Tier2Model: "tier2",
		Tier3Model: "tier3-default",
		Tier4Model: "tier4",
		Tier5Model: "tier5-cheap",
	}
}

func TestResolveModel(t *testing.T) {
	p := newTestProfile()
	cases := []struct {
		score     float64
		wantModel string
		wantTier  int
	}{
		{0, "tier5-cheap", 5},   // 区间下界
		{2, "tier5-cheap", 5},   // 区间内
		{3, "tier4", 4},         // 边界归入下一档 [3,5)
		{6, "tier3-default", 3}, // 中间
		{8.5, "tier2", 2},
		{9, "tier1-strong", 1},  // 进入末档 [9,10]
		{10, "tier1-strong", 1}, // 末档上界(闭区间)
	}
	for _, c := range cases {
		gotModel, gotTier := p.ResolveModel(c.score)
		if gotModel != c.wantModel || gotTier != c.wantTier {
			t.Errorf("score %.1f: got (%s, tier%d), want (%s, tier%d)",
				c.score, gotModel, gotTier, c.wantModel, c.wantTier)
		}
	}
}

func TestResolveModelDefaults(t *testing.T) {
	p := newTestProfile()

	// 无任何档位匹配（分数超范围）→ 兜底 tier3
	if m, _ := p.ResolveModel(-1); m != "tier3-default" {
		t.Errorf("out-of-range score should fall back to tier3, got %s", m)
	}

	// 命中档位但该档模型为空 → 兜底默认档，tier 必须跟随实际生效的模型。
	// 若保留命中档(旧行为)，日志/监控里 tier 与实际模型(组)错位，按 tier 归因必错。
	p.Tier1Model = ""
	m, tier := p.ResolveModel(9.5)
	if m != "tier3-default" || tier != 3 {
		t.Errorf("empty tier1 should fall back to tier3 model with tier=3, got (%s, tier%d)", m, tier)
	}

	// DefaultModel：优先 tier3
	if m, tier := p.DefaultModel(); m != "tier3-default" || tier != 3 {
		t.Errorf("DefaultModel should prefer tier3, got (%s, tier%d)", m, tier)
	}
}
