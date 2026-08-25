package middleware

import (
	"bytes"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func newJSONRequestContext(body []byte) *gin.Context {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	return ctx
}
func TestGetModelFromJSONBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"model":"Nemotron-3.5-Lightning-30B-A3B","group":"default","messages":[]}`)
	ctx := newJSONRequestContext(body)

	request, err := getModelFromJSONBody(ctx)
	if err != nil {
		t.Fatalf("getModelFromJSONBody returned error: %v", err)
	}
	if request.Model != "Nemotron-3.5-Lightning-30B-A3B" || request.Group != "default" {
		t.Fatalf("unexpected model request: %+v", request)
	}

	replayed, err := io.ReadAll(ctx.Request.Body)
	if err != nil {
		t.Fatalf("read replayed body: %v", err)
	}
	if !bytes.Equal(replayed, body) {
		t.Fatalf("replayed body changed: got %q want %q", replayed, body)
	}
}

func TestGetModelFromJSONBodyToleratesInvalidUTF8InToolResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := append([]byte(`{"model":"Nemotron-3.5-Lightning-30B-A3B","messages":[{"role":"tool","content":"`), 0xff)
	body = append(body, []byte(`"}]}`)...)
	ctx := newJSONRequestContext(body)

	request, err := getModelFromJSONBody(ctx)
	if err != nil {
		t.Fatalf("invalid UTF-8 should be recoverable: %v", err)
	}
	if request.Model != "Nemotron-3.5-Lightning-30B-A3B" {
		t.Fatalf("unexpected model: %q", request.Model)
	}
}

func TestGetModelFromJSONBodyReportsSyntaxDetails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := newJSONRequestContext([]byte(`{"model":"Nemotron-3.5-Lightning-30B-A3B","messages":[}`))

	_, err := getModelFromJSONBody(ctx)
	if err == nil {
		t.Fatal("expected malformed JSON to fail")
	}
	if !strings.Contains(err.Error(), "invalid JSON request body:") || !strings.Contains(err.Error(), "invalid character") {
		t.Fatalf("expected detailed syntax error, got: %v", err)
	}
}
