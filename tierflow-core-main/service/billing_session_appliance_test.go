package service

import (
	"net/http/httptest"
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
	relaycommon "github.com/Zer0Echo/tierflow-core/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func enableApplianceModeForTest(t *testing.T) {
	t.Helper()
	previous := common.ApplianceMode
	common.ApplianceMode = true
	t.Cleanup(func() {
		common.ApplianceMode = previous
	})
}

func TestNewBillingSessionApplianceModeBypassesQuota(t *testing.T) {
	enableApplianceModeForTest(t)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId:   42,
		TokenId:  99,
		TokenKey: "appliance-test-key",
	}

	session, apiErr := NewBillingSession(ctx, relayInfo, 500)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	require.Equal(t, 0, session.GetPreConsumedQuota())
	require.Equal(t, BillingSourceWallet, relayInfo.BillingSource)
	require.NoError(t, session.Reserve(5_000))
	require.NoError(t, session.Settle(10_000))
}

func TestLegacyQuotaPathsAreNoOpsInApplianceMode(t *testing.T) {
	enableApplianceModeForTest(t)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId:   42,
		TokenId:  99,
		TokenKey: "appliance-test-key",
	}

	require.Nil(t, PreConsumeQuota(ctx, 500, relayInfo))
	require.Equal(t, 0, relayInfo.FinalPreConsumedQuota)
	require.NoError(t, PreConsumeTokenQuota(relayInfo, 500))
	require.NoError(t, PostConsumeQuota(relayInfo, 500, 0, true))
}
