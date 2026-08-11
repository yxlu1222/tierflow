package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestIsKeyScopedStatusCode covers the key-scoped vs channel-scoped split that
// drives single-request key rotation: 401/403/429 rotate to another key of the
// same channel; 5xx / network (out-of-range) codes switch channels.
func TestIsKeyScopedStatusCode(t *testing.T) {
	// Restore defaults after mutating the configurable range.
	orig := RouteKeyRotationStatusCodeRanges
	t.Cleanup(func() { RouteKeyRotationStatusCodeRanges = orig })

	keyScoped := []int{401, 403, 429}
	for _, code := range keyScoped {
		require.Truef(t, IsKeyScopedStatusCode(code), "%d should be key-scoped", code)
	}

	channelScoped := []int{400, 404, 408, 500, 502, 503, 504, 200, 0, 700}
	for _, code := range channelScoped {
		require.Falsef(t, IsKeyScopedStatusCode(code), "%d should be channel-scoped", code)
	}

	// The set is configurable: narrowing it to 429 only reclassifies 401/403.
	require.NoError(t, RouteKeyRotationStatusCodesFromString("429"))
	require.True(t, IsKeyScopedStatusCode(429))
	require.False(t, IsKeyScopedStatusCode(401))
	require.False(t, IsKeyScopedStatusCode(403))
}
