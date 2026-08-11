package model

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/pkg/routehealth"
)

// TestSelectionExcludesCooledAndFailedChannels exercises the full selection path
// (GetRandomSatisfiedChannel*) together with the routehealth breaker: a cooled
// channel must be skipped, and per-request exclusion must fail over to another
// channel — while never hard-failing when everything is filtered out.
func TestSelectionExcludesCooledAndFailedChannels(t *testing.T) {
	origCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	t.Cleanup(func() { common.MemoryCacheEnabled = origCache })

	// Two channels serving the same (group, model) at equal priority/weight —
	// i.e. the same model available from two upstreams.
	chA := &Channel{Id: 101, Status: common.ChannelStatusEnabled}
	chB := &Channel{Id: 102, Status: common.ChannelStatusEnabled}

	channelSyncLock.Lock()
	origIDM := channelsIDM
	origMap := group2model2channels
	channelsIDM = map[int]*Channel{101: chA, 102: chB}
	group2model2channels = map[string]map[string][]int{
		"default": {"gpt-x": {101, 102}},
	}
	channelSyncLock.Unlock()
	t.Cleanup(func() {
		channelSyncLock.Lock()
		channelsIDM = origIDM
		group2model2channels = origMap
		channelSyncLock.Unlock()
	})

	routehealth.Configure(routehealth.Config{
		Enabled:          true,
		FailureThreshold: 1,
		WindowSeconds:    60,
		CooldownSeconds:  300,
		MaxCooldownSecs:  300,
		TripStatusCodes:  []routehealth.IntRange{{Start: 500, End: 500}},
	})
	t.Cleanup(func() { routehealth.Configure(routehealth.DefaultConfig()) })

	// Trip channel A (101). Selection must now always fail over to B (102).
	routehealth.RecordFailure(101, -1, 500)
	for i := 0; i < 50; i++ {
		ch, err := GetRandomSatisfiedChannel("default", "gpt-x", 0)
		if err != nil {
			t.Fatalf("selection error: %v", err)
		}
		if ch == nil || ch.Id != 102 {
			t.Fatalf("cooled channel 101 should be skipped; got %+v", ch)
		}
	}

	// Per-request exclusion of 102 while 101 is cooling: both are filtered, but
	// selection must relax rather than return nil (a cooling channel beats a
	// hard failure).
	ch, err := GetRandomSatisfiedChannelExcluding("default", "gpt-x", 0, map[int]bool{102: true})
	if err != nil {
		t.Fatalf("selection error on full exclusion: %v", err)
	}
	if ch == nil {
		t.Fatalf("expected a fallback channel, got nil")
	}
	// (Half-open recovery after the cooldown elapses is covered by the
	// fake-clock unit tests in pkg/routehealth; it can't be time-advanced here.)
}
