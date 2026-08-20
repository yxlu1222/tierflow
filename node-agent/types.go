package main

import "time"

const agentVersion = "0.2.0"

type persistedState struct {
	Draining bool `json:"draining"`
}

type memoryStatus struct {
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
}

type cpuStatus struct {
	UsagePercent float64 `json:"usage_percent"`
}

type cudaStatus struct {
	Available          bool    `json:"available"`
	Name               string  `json:"name,omitempty"`
	UtilizationPercent float64 `json:"utilization_percent,omitempty"`
	MemoryTotalBytes   uint64  `json:"memory_total_bytes,omitempty"`
	MemoryUsedBytes    uint64  `json:"memory_used_bytes,omitempty"`
	UnifiedMemoryBytes uint64  `json:"unified_memory_bytes,omitempty"`
}

type diskStatus struct {
	Path           string `json:"path"`
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
}

type modelStatus struct {
	ID              string `json:"id"`
	DisplayName     string `json:"display_name"`
	Service         string `json:"service"`
	Endpoint        string `json:"endpoint,omitempty"`
	ChannelID       int    `json:"channel_id,omitempty"`
	State           string `json:"state"`
	SubState        string `json:"sub_state,omitempty"`
	MainPID         int64  `json:"main_pid,omitempty"`
	MemoryBytes     uint64 `json:"memory_bytes,omitempty"`
	EndpointHealthy bool   `json:"endpoint_healthy"`
	ManifestPresent bool   `json:"manifest_present"`
}

type nodeStatus struct {
	NodeName     string        `json:"node_name"`
	Hostname     string        `json:"hostname"`
	Role         string        `json:"role"`
	AgentURL     string        `json:"agent_url"`
	AgentVersion string        `json:"agent_version"`
	Draining     bool          `json:"draining"`
	CPU          cpuStatus     `json:"cpu"`
	Memory       memoryStatus  `json:"memory"`
	CUDA         cudaStatus    `json:"cuda"`
	Disk         diskStatus    `json:"disk"`
	Models       []modelStatus `json:"models"`
	CollectedAt  int64         `json:"collected_at"`
}

type actionRequest struct {
	Action string `json:"action"`
}

type drainRequest struct {
	Draining bool `json:"draining"`
}

type actionResponse struct {
	Model  modelStatus `json:"model"`
	Action string      `json:"action"`
	At     time.Time   `json:"at"`
}

type manifestFileResult struct {
	Path     string `json:"path"`
	Expected string `json:"expected,omitempty"`
	Actual   string `json:"actual,omitempty"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

type manifestResult struct {
	ModelID   string               `json:"model_id"`
	Manifest  string               `json:"manifest"`
	OK        bool                 `json:"ok"`
	CheckedAt int64                `json:"checked_at"`
	Files     []manifestFileResult `json:"files"`
}
