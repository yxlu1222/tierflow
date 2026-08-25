package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestBindClientRequestContextPropagatesCancellation(t *testing.T) {
	gin.SetMode(gin.TestMode)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	clientCtx, cancelClient := context.WithCancel(context.Background())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil).WithContext(clientCtx)

	upstreamReq, err := http.NewRequest(http.MethodPost, "http://127.0.0.1:8101/v1/chat/completions", nil)
	if err != nil {
		t.Fatalf("create upstream request: %v", err)
	}
	bound := bindClientRequestContext(c, upstreamReq)

	cancelClient()
	select {
	case <-bound.Context().Done():
	default:
		t.Fatal("client cancellation was not propagated to upstream request context")
	}
}
