package operation_setting

import "github.com/Zer0Echo/tierflow-core/pkg/routehealth"

// Route breaker (circuit-breaker / cooldown) settings. These control the
// in-memory breaker in pkg/routehealth that temporarily cools down a channel or
// an individual multi-key key after transient upstream failures (429 / 5xx),
// then automatically probes and recovers.
//
// This is complementary to the auto-disable path (AutomaticDisableStatusCodes,
// default 401): auto-disable handles permanent faults and persists to the DB;
// the breaker handles transient faults in memory and recovers on its own.
var (
	RouteBreakerEnabled          = true
	RouteBreakerKeyLevelEnabled  = true
	RouteBreakerFailureThreshold = 3
	RouteBreakerWindowSeconds    = 60
	RouteBreakerCooldownSeconds  = 30
	RouteBreakerMaxCooldownSecs  = 300

	// Status codes that count as a transient failure for the breaker. Kept
	// separate from AutomaticDisableStatusCodeRanges so 429/5xx cool down and
	// self-recover instead of being permanently disabled.
	RouteBreakerTripStatusCodeRanges = []StatusCodeRange{{Start: 429, End: 429}, {Start: 500, End: 504}, {Start: 520, End: 599}}

	// --- Single-request key rotation (TierFlow HA) ---
	// When a multi-key channel's current key fails with a KEY-scoped error, retry
	// another untried key of the SAME channel before failing over to a different
	// channel. Only when the channel's keys are exhausted (or the error is
	// channel-scoped) do we switch channels.
	RouteKeyRotationEnabled = true
	// RouteKeyRotationMaxPerChannel is the per-channel inner budget: at most this
	// many EXTRA keys are tried on one channel within a single request, separate
	// from the cross-channel RetryTimes budget.
	RouteKeyRotationMaxPerChannel = 2
	// RouteMaxTotalAttempts is a hard ceiling on total upstream attempts per
	// request (key rotations + channel switches combined), preventing runaway
	// loops on channels with many keys.
	RouteMaxTotalAttempts = 6
	// RouteKeyRotationStatusCodeRanges are the KEY-scoped failure codes that
	// trigger same-channel key rotation: 401/403 (invalid/expired key) and 429
	// (per-account rate limit). Everything else (5xx / network / timeout) is
	// treated as CHANNEL-scoped and switches channels immediately, since all keys
	// of a channel share one upstream endpoint.
	RouteKeyRotationStatusCodeRanges = []StatusCodeRange{{Start: 401, End: 401}, {Start: 403, End: 403}, {Start: 429, End: 429}}
)

func RouteKeyRotationStatusCodesToString() string {
	return statusCodeRangesToString(RouteKeyRotationStatusCodeRanges)
}

func RouteKeyRotationStatusCodesFromString(s string) error {
	ranges, err := ParseHTTPStatusCodeRanges(s)
	if err != nil {
		return err
	}
	RouteKeyRotationStatusCodeRanges = ranges
	return nil
}

// IsKeyScopedStatusCode reports whether an upstream failure with this HTTP
// status code should rotate to another key of the same channel (true) rather
// than fail over to a different channel (false). Channel-wide faults (5xx,
// network/transport codes outside 100-599) are never key-scoped.
func IsKeyScopedStatusCode(code int) bool {
	return shouldMatchStatusCodeRanges(RouteKeyRotationStatusCodeRanges, code)
}

func RouteBreakerTripStatusCodesToString() string {
	return statusCodeRangesToString(RouteBreakerTripStatusCodeRanges)
}

func RouteBreakerTripStatusCodesFromString(s string) error {
	ranges, err := ParseHTTPStatusCodeRanges(s)
	if err != nil {
		return err
	}
	RouteBreakerTripStatusCodeRanges = ranges
	ApplyRouteBreakerConfig()
	return nil
}

// ApplyRouteBreakerConfig pushes the current settings into the routehealth
// breaker. Call it after mutating any RouteBreaker* variable.
func ApplyRouteBreakerConfig() {
	tripRanges := make([]routehealth.IntRange, 0, len(RouteBreakerTripStatusCodeRanges))
	for _, r := range RouteBreakerTripStatusCodeRanges {
		tripRanges = append(tripRanges, routehealth.IntRange{Start: r.Start, End: r.End})
	}
	routehealth.Configure(routehealth.Config{
		Enabled:          RouteBreakerEnabled,
		KeyLevelEnabled:  RouteBreakerKeyLevelEnabled,
		FailureThreshold: RouteBreakerFailureThreshold,
		WindowSeconds:    RouteBreakerWindowSeconds,
		CooldownSeconds:  RouteBreakerCooldownSeconds,
		MaxCooldownSecs:  RouteBreakerMaxCooldownSecs,
		TripStatusCodes:  tripRanges,
	})
}
