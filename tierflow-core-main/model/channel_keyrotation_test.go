package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"
	"github.com/Zer0Echo/tierflow-core/types"
)

// newMultiKeyChannel builds an in-memory 3-key multi-key channel (Random mode,
// no persisted key-status list → all keys enabled) for key-rotation tests.
func newMultiKeyChannel(id int) *Channel {
	return &Channel{
		Id:     id,
		Status: common.ChannelStatusEnabled,
		Key:    "k0\nk1\nk2",
		ChannelInfo: ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 3,
			MultiKeyMode: constant.MultiKeyModeRandom,
		},
	}
}

// TestGetNextEnabledKeyExcluding verifies single-request key rotation at the key
// selection layer: excluded (already-tried) key indexes are never returned, and
// when every enabled key is excluded the call reports no available key so the
// caller can switch channels.
func TestGetNextEnabledKeyExcluding(t *testing.T) {
	routehealth.Configure(routehealth.Config{Enabled: false})
	t.Cleanup(func() { routehealth.Configure(routehealth.DefaultConfig()) })

	ch := newMultiKeyChannel(301)

	// Excluding key 0 → must always return key 1 or 2, never 0.
	for i := 0; i < 100; i++ {
		_, idx, err := ch.GetNextEnabledKeyExcluding(map[int]bool{0: true})
		if err != nil {
			t.Fatalf("unexpected error excluding {0}: %v", err)
		}
		if idx == 0 {
			t.Fatalf("excluded key index 0 was returned")
		}
	}

	// Excluding keys 0 and 1 → must always return key 2.
	for i := 0; i < 100; i++ {
		_, idx, err := ch.GetNextEnabledKeyExcluding(map[int]bool{0: true, 1: true})
		if err != nil {
			t.Fatalf("unexpected error excluding {0,1}: %v", err)
		}
		if idx != 2 {
			t.Fatalf("expected key index 2, got %d", idx)
		}
	}

	// Excluding all keys → keys exhausted, must report no available key.
	_, _, err := ch.GetNextEnabledKeyExcluding(map[int]bool{0: true, 1: true, 2: true})
	if err == nil {
		t.Fatalf("expected error when all keys excluded, got nil")
	}
	if err.GetErrorCode() != types.ErrorCodeChannelNoAvailableKey {
		t.Fatalf("expected ErrorCodeChannelNoAvailableKey, got %s", err.GetErrorCode())
	}

	// nil exclude set behaves like the plain GetNextEnabledKey (a key is returned).
	if _, _, err := ch.GetNextEnabledKeyExcluding(nil); err != nil {
		t.Fatalf("unexpected error with nil exclude: %v", err)
	}
}

// TestGetNextEnabledKeyExcludingCoolingRespectsExclusion verifies that the
// cooling-key fallback never resurrects an excluded (already-tried) key: when the
// only non-excluded keys are cooling, one of them is returned rather than the
// excluded key.
func TestGetNextEnabledKeyExcludingCoolingRespectsExclusion(t *testing.T) {
	routehealth.Configure(routehealth.Config{
		Enabled:          true,
		KeyLevelEnabled:  true,
		FailureThreshold: 1,
		WindowSeconds:    60,
		CooldownSeconds:  300,
		MaxCooldownSecs:  300,
		TripStatusCodes:  []routehealth.IntRange{{Start: 429, End: 429}},
	})
	t.Cleanup(func() { routehealth.Configure(routehealth.DefaultConfig()) })

	ch := newMultiKeyChannel(302)
	// Cool keys 1 and 2 (429). With key 0 excluded, every enabled non-excluded key
	// is cooling → the selector must fall back to a cooling key (1 or 2), never the
	// excluded key 0.
	routehealth.RecordFailure(302, 1, 429)
	routehealth.RecordFailure(302, 2, 429)

	for i := 0; i < 50; i++ {
		_, idx, err := ch.GetNextEnabledKeyExcluding(map[int]bool{0: true})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if idx == 0 {
			t.Fatalf("excluded key 0 was resurrected by the cooling fallback")
		}
	}
}

// TestHasUntriedEnabledKey verifies the read-only rotation gate.
func TestHasUntriedEnabledKey(t *testing.T) {
	ch := newMultiKeyChannel(303)

	if !ch.HasUntriedEnabledKey(nil) {
		t.Fatalf("fresh multi-key channel should have untried keys")
	}
	if !ch.HasUntriedEnabledKey(map[int]bool{0: true, 1: true}) {
		t.Fatalf("key 2 is still untried")
	}
	if ch.HasUntriedEnabledKey(map[int]bool{0: true, 1: true, 2: true}) {
		t.Fatalf("all keys tried → should report exhausted")
	}

	// Single-key (non-multi-key) channels have nothing to rotate to.
	single := &Channel{Id: 304, Status: common.ChannelStatusEnabled, Key: "solo"}
	if single.HasUntriedEnabledKey(nil) {
		t.Fatalf("non-multi-key channel must report no untried key")
	}
}
