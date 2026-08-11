// Package routehealth implements a lightweight, in-memory circuit breaker for
// upstream routing. It temporarily cools down a channel (or an individual key
// within a multi-key channel) after it produces transient failures (e.g. 429
// rate limits or 5xx instability), then automatically probes it after a
// cooldown and recovers on success ("half-open").
//
// It is intentionally a leaf package (stdlib only) so it can be imported by the
// low-level model package that performs channel/key selection as well as by the
// controller/relay layer that records request outcomes. Configuration is pushed
// in via Configure (wired from model/option.go); it never reaches back into the
// settings packages, keeping the dependency graph acyclic.
//
// Division of labour with the existing auto-disable path: auto-disable
// (DB-persistent, service/channel.go) handles permanent faults such as 401 auth
// errors and requires a health probe to recover. This breaker handles transient
// faults and recovers on its own, so 429/5xx no longer need to permanently
// disable a channel.
package routehealth

import (
	"strconv"
	"sync"
	"time"
)

// State is the coarse breaker state. HalfOpen is derived (Open with an elapsed
// cooldown), never stored, so availability checks stay side-effect free.
type State int

const (
	StateClosed State = iota
	StateOpen
	StateHalfOpen
)

func (s State) String() string {
	switch s {
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half_open"
	default:
		return "closed"
	}
}

// IntRange is an inclusive [Start, End] HTTP status-code range.
type IntRange struct {
	Start int
	End   int
}

// Config controls breaker behaviour. It is read live on each event.
type Config struct {
	Enabled          bool
	KeyLevelEnabled  bool
	FailureThreshold int
	WindowSeconds    int
	CooldownSeconds  int
	MaxCooldownSecs  int
	TripStatusCodes  []IntRange
}

// DefaultConfig returns the shipped defaults. Kept in sync with
// setting/operation_setting/route_breaker_setting.go.
func DefaultConfig() Config {
	return Config{
		Enabled:          true,
		KeyLevelEnabled:  true,
		FailureThreshold: 3,
		WindowSeconds:    60,
		CooldownSeconds:  30,
		MaxCooldownSecs:  300,
		TripStatusCodes:  []IntRange{{429, 429}, {500, 504}, {520, 599}},
	}
}

// pruneThreshold caps the number of tracked entries before idle closed ones are
// reclaimed. Cardinality is normally tiny (#channels × #keys); this only guards
// against churn from admins repeatedly adding/removing channels.
const pruneThreshold = 10000

// nowFunc is overridable in tests for deterministic time control.
var nowFunc = time.Now

type entry struct {
	mu          sync.Mutex
	scope       string // "channel" | "key"
	channelId   int
	keyIndex    int // -1 for channel scope
	state       State
	failCount   int
	windowStart int64 // unix nanos
	openUntil   int64 // unix nanos
	tripCount   int   // consecutive trips, drives exponential backoff
	lastChange  int64 // unix nanos
}

type manager struct {
	mu      sync.RWMutex
	entries map[string]*entry
	cfg     Config
}

var mgr = &manager{
	entries: make(map[string]*entry),
	cfg:     DefaultConfig(),
}

// Configure replaces the active configuration. Values are sanitised so a
// misconfiguration can never wedge the breaker.
func Configure(c Config) {
	if c.FailureThreshold < 1 {
		c.FailureThreshold = 1
	}
	if c.WindowSeconds < 1 {
		c.WindowSeconds = 60
	}
	if c.CooldownSeconds < 1 {
		c.CooldownSeconds = 30
	}
	if c.MaxCooldownSecs < c.CooldownSeconds {
		c.MaxCooldownSecs = c.CooldownSeconds
	}
	mgr.mu.Lock()
	mgr.cfg = c
	mgr.mu.Unlock()
}

func getCfg() Config {
	mgr.mu.RLock()
	defer mgr.mu.RUnlock()
	return mgr.cfg
}

func channelCacheKey(id int) string { return "ch:" + strconv.Itoa(id) }

func keyCacheKey(id, idx int) string {
	return "ch:" + strconv.Itoa(id) + ":k:" + strconv.Itoa(idx)
}

func (m *manager) get(k, scope string, channelId, keyIndex int) *entry {
	m.mu.RLock()
	e := m.entries[k]
	m.mu.RUnlock()
	if e != nil {
		return e
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if e = m.entries[k]; e != nil {
		return e
	}
	if len(m.entries) >= pruneThreshold {
		m.pruneLocked()
	}
	e = &entry{scope: scope, channelId: channelId, keyIndex: keyIndex, state: StateClosed}
	m.entries[k] = e
	return e
}

func (m *manager) peek(k string) *entry {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.entries[k]
}

// pruneLocked removes closed, long-idle entries. Caller must hold m.mu.
func (m *manager) pruneLocked() {
	now := nowFunc().UnixNano()
	idleCutoff := int64(time.Hour)
	for k, e := range m.entries {
		e.mu.Lock()
		idle := e.state == StateClosed && now-e.lastChange > idleCutoff
		e.mu.Unlock()
		if idle {
			delete(m.entries, k)
		}
	}
}

func codeInRanges(code int, ranges []IntRange) bool {
	for _, r := range ranges {
		if code >= r.Start && code <= r.End {
			return true
		}
	}
	return false
}

func backoffNanos(cfg Config, tripCount int) int64 {
	secs := cfg.CooldownSeconds
	for i := 1; i < tripCount; i++ {
		secs *= 2
		if secs >= cfg.MaxCooldownSecs {
			secs = cfg.MaxCooldownSecs
			break
		}
	}
	if secs > cfg.MaxCooldownSecs {
		secs = cfg.MaxCooldownSecs
	}
	return int64(secs) * int64(time.Second)
}

// RecordFailure reports a failed upstream attempt. statusCode is only counted
// when it matches the configured trip ranges (transient faults). For a
// multi-key channel pass the used key index (>=0) so only that key cools down;
// for a single-key channel pass keyIndex < 0 to cool the channel itself.
func RecordFailure(channelId, keyIndex, statusCode int) {
	cfg := getCfg()
	if !cfg.Enabled {
		return
	}
	if !codeInRanges(statusCode, cfg.TripStatusCodes) {
		return
	}
	if keyIndex >= 0 && cfg.KeyLevelEnabled {
		recordFailureEntry(mgr.get(keyCacheKey(channelId, keyIndex), "key", channelId, keyIndex), cfg)
		return
	}
	recordFailureEntry(mgr.get(channelCacheKey(channelId), "channel", channelId, -1), cfg)
}

func recordFailureEntry(e *entry, cfg Config) {
	now := nowFunc().UnixNano()
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.state == StateOpen {
		if now < e.openUntil {
			// Still cooling; already tripped. Ignore piled-up failures.
			return
		}
		// Half-open probe failed → re-trip with a longer cooldown.
		e.tripCount++
		e.openUntil = now + backoffNanos(cfg, e.tripCount)
		e.lastChange = now
		return
	}

	windowNs := int64(cfg.WindowSeconds) * int64(time.Second)
	if e.windowStart == 0 || now-e.windowStart > windowNs {
		e.windowStart = now
		e.failCount = 0
	}
	e.failCount++
	if e.failCount >= cfg.FailureThreshold {
		e.tripCount = 1
		e.state = StateOpen
		e.openUntil = now + backoffNanos(cfg, e.tripCount)
		e.failCount = 0
		e.lastChange = now
	}
}

// RecordSuccess reports a successful upstream attempt, closing the breaker for
// the channel and (when applicable) the used key.
func RecordSuccess(channelId, keyIndex int) {
	if !getCfg().Enabled {
		return
	}
	if keyIndex >= 0 {
		recordSuccessEntry(mgr.peek(keyCacheKey(channelId, keyIndex)))
	}
	recordSuccessEntry(mgr.peek(channelCacheKey(channelId)))
}

func recordSuccessEntry(e *entry) {
	if e == nil {
		return
	}
	now := nowFunc().UnixNano()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state == StateOpen && now < e.openUntil {
		// Strictly cooling: hold the cooldown, ignore stray in-flight successes.
		return
	}
	e.state = StateClosed
	e.failCount = 0
	e.windowStart = 0
	e.openUntil = 0
	e.tripCount = 0
	e.lastChange = now
}

func (e *entry) availableAt(now int64) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.state == StateClosed || now >= e.openUntil
}

// IsAvailable reports whether the channel (keyIndex < 0) or a specific key
// (keyIndex >= 0) is currently eligible for selection. A cooled entry becomes
// available again once its cooldown elapses (half-open). This is a pure read.
func IsAvailable(channelId, keyIndex int) bool {
	cfg := getCfg()
	if !cfg.Enabled {
		return true
	}
	var k string
	if keyIndex >= 0 {
		if !cfg.KeyLevelEnabled {
			return true
		}
		k = keyCacheKey(channelId, keyIndex)
	} else {
		k = channelCacheKey(channelId)
	}
	e := mgr.peek(k)
	if e == nil {
		return true
	}
	return e.availableAt(nowFunc().UnixNano())
}

// IsChannelAvailable is a convenience wrapper for channel-scope availability.
func IsChannelAvailable(channelId int) bool { return IsAvailable(channelId, -1) }

// StateOf returns the derived breaker state ("closed" | "open" | "half_open")
// for a channel (keyIndex < 0) or a key. Pure read.
func StateOf(channelId, keyIndex int) string {
	var k string
	if keyIndex >= 0 {
		k = keyCacheKey(channelId, keyIndex)
	} else {
		k = channelCacheKey(channelId)
	}
	e := mgr.peek(k)
	if e == nil {
		return StateClosed.String()
	}
	now := nowFunc().UnixNano()
	e.mu.Lock()
	defer e.mu.Unlock()
	st := e.state
	if st == StateOpen && now >= e.openUntil {
		st = StateHalfOpen
	}
	return st.String()
}

// CooldownRemainingSeconds returns the seconds left until a cooling entry
// becomes probeable again, or 0 if it is not currently cooling. Pure read.
func CooldownRemainingSeconds(channelId, keyIndex int) int64 {
	var k string
	if keyIndex >= 0 {
		k = keyCacheKey(channelId, keyIndex)
	} else {
		k = channelCacheKey(channelId)
	}
	e := mgr.peek(k)
	if e == nil {
		return 0
	}
	now := nowFunc().UnixNano()
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state != StateOpen || now >= e.openUntil {
		return 0
	}
	return (e.openUntil - now) / int64(time.Second)
}

// FilterAvailableChannelIds drops channel ids that are currently cooling down.
// If every candidate is cooling, the original slice is returned unchanged —
// trying a cooling channel beats failing the request outright.
func FilterAvailableChannelIds(ids []int) []int {
	cfg := getCfg()
	if !cfg.Enabled || len(ids) == 0 {
		return ids
	}
	now := nowFunc().UnixNano()
	out := make([]int, 0, len(ids))
	for _, id := range ids {
		e := mgr.peek(channelCacheKey(id))
		if e == nil || e.availableAt(now) {
			out = append(out, id)
		}
	}
	if len(out) == 0 {
		return ids
	}
	return out
}

// SnapshotEntry is one breaker's externally visible state.
type SnapshotEntry struct {
	Scope          string `json:"scope"` // "channel" | "key"
	ChannelId      int    `json:"channel_id"`
	KeyIndex       int    `json:"key_index"`  // -1 for channel scope
	State          string `json:"state"`      // closed | open | half_open
	OpenUntil      int64  `json:"open_until"` // unix seconds, 0 when closed
	RecentFailures int    `json:"recent_failures"`
	TripCount      int    `json:"trip_count"`
}

// Snapshot returns the current state of every tracked breaker for observability.
func Snapshot() []SnapshotEntry {
	now := nowFunc().UnixNano()
	mgr.mu.RLock()
	entries := make([]*entry, 0, len(mgr.entries))
	for _, e := range mgr.entries {
		entries = append(entries, e)
	}
	mgr.mu.RUnlock()

	out := make([]SnapshotEntry, 0, len(entries))
	for _, e := range entries {
		e.mu.Lock()
		state := e.state
		if state == StateOpen && now >= e.openUntil {
			state = StateHalfOpen
		}
		openUntil := int64(0)
		if e.state == StateOpen {
			openUntil = e.openUntil / int64(time.Second)
		}
		out = append(out, SnapshotEntry{
			Scope:          e.scope,
			ChannelId:      e.channelId,
			KeyIndex:       e.keyIndex,
			State:          state.String(),
			OpenUntil:      openUntil,
			RecentFailures: e.failCount,
			TripCount:      e.tripCount,
		})
		e.mu.Unlock()
	}
	return out
}

// reset clears all state. Test-only helper.
func reset() {
	mgr.mu.Lock()
	mgr.entries = make(map[string]*entry)
	mgr.cfg = DefaultConfig()
	mgr.mu.Unlock()
}
