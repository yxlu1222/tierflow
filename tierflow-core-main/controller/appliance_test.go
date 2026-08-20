package controller

import (
	"strings"
	"testing"

	"github.com/Zer0Echo/tierflow-core/constant"
)

func TestParseNvidiaGPUCSV(t *testing.T) {
	items, err := parseNvidiaGPUCSV(strings.NewReader("0, NVIDIA GB10, GPU-test, 580.00, 47, 61, 122880, 40960, 92.5, 140.0\n"))
	if err != nil {
		t.Fatalf("parseNvidiaGPUCSV returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected one GPU, got %d", len(items))
	}
	if items[0].Name != "NVIDIA GB10" || items[0].MemoryTotalBytes != 122880*1024*1024 {
		t.Fatalf("unexpected parsed GPU: %#v", items[0])
	}
	if items[0].MemoryUsedPercent < 33 || items[0].MemoryUsedPercent > 34 {
		t.Fatalf("unexpected memory percentage: %f", items[0].MemoryUsedPercent)
	}
	if items[0].MemoryType != "dedicated" {
		t.Fatalf("expected dedicated memory, got %q", items[0].MemoryType)
	}
}

func TestParseNvidiaGPUCSVAllowsUnsupportedMetrics(t *testing.T) {
	items, err := parseNvidiaGPUCSV(strings.NewReader("0, NVIDIA GPU, GPU-test, 580.00, N/A, 0, 1024, 0, [Not Supported], N/A\n"))
	if err != nil || len(items) != 1 {
		t.Fatalf("unexpected result: %#v, %v", items, err)
	}
	if items[0].TemperatureCelsius != nil || items[0].PowerDrawWatts != nil {
		t.Fatalf("unsupported metrics must remain nil: %#v", items[0])
	}
}

func TestParseCUDAUnifiedMemoryOutput(t *testing.T) {
	total, used, ok := parseCUDAUnifiedMemoryOutput("130662936576 102968029184\n")
	if !ok || total != 130662936576 || used != 27694907392 {
		t.Fatalf("unexpected CUDA memory result: total=%d used=%d ok=%v", total, used, ok)
	}
	if _, _, ok := parseCUDAUnifiedMemoryOutput("N/A N/A"); ok {
		t.Fatal("invalid CUDA memory output must not be accepted")
	}
}

func TestParseLSCPUModelNamesSupportsHeterogeneousARMCPU(t *testing.T) {
	models := parseLSCPUModelNames(`Architecture: aarch64
Model name: Cortex-X925
Model name: Cortex-A725
Model name: Cortex-A725
`)
	if len(models) != 2 || models[0] != "Cortex-X925" || models[1] != "Cortex-A725" {
		t.Fatalf("unexpected CPU models: %#v", models)
	}
}

func TestIsLiveTemperatureSensorRejectsThresholds(t *testing.T) {
	if !isLiveTemperatureSensor("acpitz_temp1input") || !isLiveTemperatureSensor("acpitz") {
		t.Fatal("live ACPI temperature readings must be accepted")
	}
	for _, key := range []string{"acpitz_temp1crit", "nvme_temp1max", "cpu_criticalarm"} {
		if isLiveTemperatureSensor(key) {
			t.Fatalf("threshold sensor %q must be rejected", key)
		}
	}
}

func TestIsLocalInferenceEndpoint(t *testing.T) {
	cases := []struct {
		channelType int
		endpoint    string
		want        bool
	}{
		{constant.ChannelTypeOllama, "http://example.com", true},
		{constant.ChannelTypeOpenAI, "http://127.0.0.1:8000/v1", true},
		{constant.ChannelTypeOpenAI, "http://vllm:8000/v1", true},
		{constant.ChannelTypeOpenAI, "https://api.openai.com/v1", false},
	}
	for _, test := range cases {
		if got := isLocalInferenceEndpoint(test.channelType, test.endpoint); got != test.want {
			t.Fatalf("isLocalInferenceEndpoint(%d, %q) = %v, want %v", test.channelType, test.endpoint, got, test.want)
		}
	}
}

func TestGetApplianceRoutingPolicyIsManaged(t *testing.T) {
	policy := getApplianceRoutingPolicy()
	if !policy.Managed || policy.Mode != "appliance_managed" {
		t.Fatalf("routing policy must be appliance managed: %#v", policy)
	}
	if policy.FailureThreshold <= 0 || policy.MaxTotalAttemptsPerRoute <= 0 {
		t.Fatalf("routing safety limits must be positive: %#v", policy)
	}
}
