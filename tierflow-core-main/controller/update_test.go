package controller

import "testing"

func TestIsNewerVersion(t *testing.T) {
	cases := []struct {
		latest, current string
		want            bool
	}{
		{"v1.0.4", "v1.0.3", true},
		{"v1.0.3", "v1.0.3", false},
		{"v1.0.3", "v1.0.4", false}, // 当前更新,不提示降级
		{"1.2.0", "v1.1.9", true},   // 容忍前缀 v、跨位比较
		{"v2.0.0", "v1.9.9", true},
		{"v1.0.4-rc1", "v1.0.3", true}, // 容忍 -suffix
		{"v1.0.3", "v1.0.3-rc1", false},
		{"dev-abc", "dev-xyz", true}, // 非 semver 退化为字符串不等
		{"same", "same", false},
	}
	for _, c := range cases {
		if got := isNewerVersion(c.latest, c.current); got != c.want {
			t.Errorf("isNewerVersion(%q,%q)=%v want %v", c.latest, c.current, got, c.want)
		}
	}
}

func TestHostPortFromURL(t *testing.T) {
	cases := map[string]string{
		"http://watchtower:8080/v1/update": "watchtower:8080",
		"http://watchtower/v1/update":      "watchtower:80",
		"https://wt.example.com/v1/update": "wt.example.com:443",
		"":                                 "",
	}
	for in, want := range cases {
		if got := hostPortFromURL(in); got != want {
			t.Errorf("hostPortFromURL(%q)=%q want %q", in, got, want)
		}
	}
}
