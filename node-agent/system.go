package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func commandOutput(ctx context.Context, name string, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

func readMemoryStatus() memoryStatus {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return memoryStatus{}
	}
	defer f.Close()
	values := make(map[string]uint64)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fields[1], 10, 64)
		if err == nil {
			values[strings.TrimSuffix(fields[0], ":")] = v * 1024
		}
	}
	total := values["MemTotal"]
	available := values["MemAvailable"]
	return memoryStatus{TotalBytes: total, AvailableBytes: available, UsedBytes: total - available}
}

func readDiskStatus(path string) diskStatus {
	status := diskStatus{Path: path}
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return status
	}
	status.TotalBytes = stat.Blocks * uint64(stat.Bsize)
	status.AvailableBytes = stat.Bavail * uint64(stat.Bsize)
	status.UsedBytes = status.TotalBytes - stat.Bfree*uint64(stat.Bsize)
	return status
}

func readCUDAStatus(ctx context.Context, memory memoryStatus) cudaStatus {
	out, err := commandOutput(ctx, "nvidia-smi", "--query-gpu=name,memory.total,memory.used", "--format=csv,noheader,nounits")
	if err != nil || out == "" {
		return cudaStatus{}
	}
	line := strings.Split(out, "\n")[0]
	parts := strings.Split(line, ",")
	status := cudaStatus{Available: true, UnifiedMemoryBytes: memory.TotalBytes}
	if len(parts) > 0 {
		status.Name = strings.TrimSpace(parts[0])
	}
	if len(parts) > 1 {
		if mb, err := strconv.ParseUint(strings.TrimSpace(parts[1]), 10, 64); err == nil {
			status.MemoryTotalBytes = mb * 1024 * 1024
		}
	}
	if len(parts) > 2 {
		if mb, err := strconv.ParseUint(strings.TrimSpace(parts[2]), 10, 64); err == nil {
			status.MemoryUsedBytes = mb * 1024 * 1024
		}
	}
	return status
}

func systemdProperties(ctx context.Context, unit string) map[string]string {
	out, _ := commandOutput(ctx, "systemctl", "show", unit,
		"--property=ActiveState,SubState,MainPID,MemoryCurrent", "--no-pager")
	props := make(map[string]string)
	for _, line := range strings.Split(out, "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			props[key] = value
		}
	}
	return props
}

func endpointHealthy(ctx context.Context, endpoint string) bool {
	if endpoint == "" {
		return false
	}
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(endpoint, "/")+"/models", nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode >= 200 && response.StatusCode < 400
}

func collectModelStatus(ctx context.Context, cfg ModelConfig) modelStatus {
	props := systemdProperties(ctx, cfg.Service)
	state := props["ActiveState"]
	if state == "" {
		state = "unknown"
	}
	pid, _ := strconv.ParseInt(props["MainPID"], 10, 64)
	memoryBytes, _ := strconv.ParseUint(props["MemoryCurrent"], 10, 64)
	return modelStatus{
		ID:              cfg.ID,
		DisplayName:     cfg.DisplayName,
		Service:         cfg.Service,
		Endpoint:        cfg.Endpoint,
		ChannelID:       cfg.ChannelID,
		State:           state,
		SubState:        props["SubState"],
		MainPID:         pid,
		MemoryBytes:     memoryBytes,
		EndpointHealthy: state == "active" && endpointHealthy(ctx, cfg.Endpoint),
		ManifestPresent: cfg.ManifestPath != "" && fileExists(cfg.ManifestPath),
	}
}

func runModelAction(ctx context.Context, unit, action string) error {
	if action != "start" && action != "stop" && action != "restart" {
		return fmt.Errorf("unsupported action %q", action)
	}
	out, err := commandOutput(ctx, "systemctl", action, unit)
	if err != nil {
		return fmt.Errorf("systemctl %s %s: %s: %w", action, unit, out, err)
	}
	return nil
}

func journalLogs(ctx context.Context, unit string, lines int) (string, error) {
	if lines < 1 {
		lines = 200
	}
	if lines > 2000 {
		lines = 2000
	}
	out, err := commandOutput(ctx, "journalctl", "-u", unit, "--no-pager", "-n", strconv.Itoa(lines), "--output=short-iso")
	if err != nil {
		return "", fmt.Errorf("journalctl %s: %w", unit, err)
	}
	return out, nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
