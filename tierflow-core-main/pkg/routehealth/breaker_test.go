package routehealth

import (
	"sync"
	"testing"
	"time"
)

// fakeClock lets tests advance time deterministically.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// withClock installs a fake clock and resets breaker state for a test.
func withClock(t *testing.T) *fakeClock {
	t.Helper()
	clk := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	orig := nowFunc
	nowFunc = clk.now
	reset()
	t.Cleanup(func() {
		nowFunc = orig
		reset()
	})
	return clk
}

func testConfig() Config {
	return Config{
		Enabled:          true,
		KeyLevelEnabled:  true,
		FailureThreshold: 3,
		WindowSeconds:    60,
		CooldownSeconds:  30,
		MaxCooldownSecs:  300,
		TripStatusCodes:  []IntRange{{429, 429}, {500, 504}},
	}
}

func TestTripsAfterThreshold(t *testing.T) {
	withClock(t)
	Configure(testConfig())

	// Two failures: still available (threshold is 3).
	RecordFailure(1, -1, 500)
	RecordFailure(1, -1, 500)
	if !IsChannelAvailable(1) {
		t.Fatalf("channel should still be available before threshold")
	}
	// Third failure trips the breaker.
	RecordFailure(1, -1, 500)
	if IsChannelAvailable(1) {
		t.Fatalf("channel should be cooling after reaching threshold")
	}
}

func TestNonTripStatusIgnored(t *testing.T) {
	withClock(t)
	Configure(testConfig())

	// 400/401/404 are not transient trip codes; they must never cool the breaker.
	for i := 0; i < 10; i++ {
		RecordFailure(1, -1, 400)
		RecordFailure(1, -1, 401)
		RecordFailure(1, -1, 404)
	}
	if !IsChannelAvailable(1) {
		t.Fatalf("non-trip status codes must not cool the channel")
	}
}

func TestCooldownAndHalfOpenRecovery(t *testing.T) {
	clk := withClock(t)
	Configure(testConfig())

	for i := 0; i < 3; i++ {
		RecordFailure(1, -1, 429)
	}
	if IsChannelAvailable(1) {
		t.Fatalf("should be cooling immediately after trip")
	}

	// Just before cooldown expiry: still unavailable.
	clk.advance(29 * time.Second)
	if IsChannelAvailable(1) {
		t.Fatalf("should still be cooling before cooldown elapses")
	}

	// After cooldown: half-open → available for a probe.
	clk.advance(2 * time.Second)
	if !IsChannelAvailable(1) {
		t.Fatalf("should be probeable (half-open) after cooldown")
	}
	states := stateByChannel(Snapshot())
	if states[1] != "half_open" {
		t.Fatalf("expected half_open, got %q", states[1])
	}

	// Probe succeeds → fully closed and reset.
	RecordSuccess(1, -1)
	if !IsChannelAvailable(1) {
		t.Fatalf("should be available after successful probe")
	}
	if states = stateByChannel(Snapshot()); states[1] != "closed" {
		t.Fatalf("expected closed after success, got %q", states[1])
	}
}

func TestHalfOpenFailureBacksOff(t *testing.T) {
	clk := withClock(t)
	Configure(testConfig())

	// First trip → 30s cooldown.
	for i := 0; i < 3; i++ {
		RecordFailure(1, -1, 500)
	}
	clk.advance(31 * time.Second) // half-open
	if !IsChannelAvailable(1) {
		t.Fatalf("expected half-open availability")
	}
	// Probe fails → re-trip with doubled cooldown (60s).
	RecordFailure(1, -1, 500)
	if IsChannelAvailable(1) {
		t.Fatalf("should cool again after failed probe")
	}
	clk.advance(31 * time.Second) // 60s cooldown not yet elapsed
	if IsChannelAvailable(1) {
		t.Fatalf("backoff should keep it cooling past the base cooldown")
	}
	clk.advance(30 * time.Second) // now > 60s total
	if !IsChannelAvailable(1) {
		t.Fatalf("should be probeable after backed-off cooldown")
	}
}

func TestBackoffCappedAtMax(t *testing.T) {
	withClock(t)
	cfg := testConfig()
	cfg.CooldownSeconds = 100
	cfg.MaxCooldownSecs = 150
	Configure(cfg)

	// tripCount 1 → 100s, tripCount 2 → 200s capped to 150s.
	if got := backoffNanos(cfg, 1); got != int64(100*time.Second) {
		t.Fatalf("trip1: want 100s, got %v", time.Duration(got))
	}
	if got := backoffNanos(cfg, 5); got != int64(150*time.Second) {
		t.Fatalf("trip5: want capped 150s, got %v", time.Duration(got))
	}
}

func TestWindowExpiryResetsCount(t *testing.T) {
	clk := withClock(t)
	Configure(testConfig())

	RecordFailure(1, -1, 500)
	RecordFailure(1, -1, 500)
	// Window (60s) elapses → count resets, so the next two failures don't trip.
	clk.advance(61 * time.Second)
	RecordFailure(1, -1, 500)
	RecordFailure(1, -1, 500)
	if !IsChannelAvailable(1) {
		t.Fatalf("failures spread beyond the window must not accumulate to a trip")
	}
}

func TestKeyLevelIsolation(t *testing.T) {
	withClock(t)
	Configure(testConfig())

	// Multi-key channel: cool key 0 only.
	for i := 0; i < 3; i++ {
		RecordFailure(7, 0, 429)
	}
	if IsAvailable(7, 0) {
		t.Fatalf("key 0 should be cooling")
	}
	if !IsAvailable(7, 1) {
		t.Fatalf("key 1 must be unaffected by key 0 cooling")
	}
	// A cooling key must NOT cool the whole channel.
	if !IsChannelAvailable(7) {
		t.Fatalf("channel scope should remain available when only one key cools")
	}
}

func TestFilterAvailableChannelIds(t *testing.T) {
	withClock(t)
	Configure(testConfig())

	for i := 0; i < 3; i++ {
		RecordFailure(2, -1, 500)
	}
	got := FilterAvailableChannelIds([]int{1, 2, 3})
	if len(got) != 2 || got[0] != 1 || got[1] != 3 {
		t.Fatalf("expected cooled channel 2 filtered out, got %v", got)
	}

	// If ALL candidates are cooling, return them unchanged (never hard-fail).
	for i := 0; i < 3; i++ {
		RecordFailure(1, -1, 500)
		RecordFailure(3, -1, 500)
	}
	got = FilterAvailableChannelIds([]int{1, 2, 3})
	if len(got) != 3 {
		t.Fatalf("all-cooling should fall back to full set, got %v", got)
	}
}

func TestDisabledIsNoop(t *testing.T) {
	withClock(t)
	cfg := testConfig()
	cfg.Enabled = false
	Configure(cfg)

	for i := 0; i < 100; i++ {
		RecordFailure(1, -1, 500)
	}
	if !IsChannelAvailable(1) {
		t.Fatalf("disabled breaker must never cool a channel")
	}
	if got := FilterAvailableChannelIds([]int{1, 2}); len(got) != 2 {
		t.Fatalf("disabled breaker must not filter, got %v", got)
	}
}

func TestKeyLevelDisabledFallsBackToChannel(t *testing.T) {
	withClock(t)
	cfg := testConfig()
	cfg.KeyLevelEnabled = false
	Configure(cfg)

	// With key-level off, a key failure cools the channel instead.
	for i := 0; i < 3; i++ {
		RecordFailure(5, 2, 429)
	}
	if IsChannelAvailable(5) {
		t.Fatalf("with key-level disabled, key failures should cool the channel")
	}
	if !IsAvailable(5, 2) {
		t.Fatalf("key-level checks should be a no-op when key-level disabled")
	}
}

func stateByChannel(entries []SnapshotEntry) map[int]string {
	out := make(map[int]string)
	for _, e := range entries {
		if e.Scope == "channel" {
			out[e.ChannelId] = e.State
		}
	}
	return out
}
