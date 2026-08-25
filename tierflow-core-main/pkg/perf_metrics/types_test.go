package perfmetrics

import (
	"testing"

	"github.com/Zer0Echo/tierflow-core/common"
)

func TestModelSummaryJSONIncludesRequestCount(t *testing.T) {
	encoded, err := common.Marshal(ModelSummary{
		ModelName:    "Qwen3.8-27B",
		AvgTtftMs:    320,
		SuccessRate:  99.5,
		RequestCount: 42,
	})
	if err != nil {
		t.Fatalf("marshal model summary: %v", err)
	}

	var payload map[string]interface{}
	if err := common.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal model summary: %v", err)
	}
	if got := payload["request_count"]; got != float64(42) {
		t.Fatalf("request_count = %#v, want 42", got)
	}
}
