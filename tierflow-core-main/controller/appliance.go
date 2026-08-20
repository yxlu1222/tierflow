package controller

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"net"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/constant"
	"github.com/Zer0Echo/tierflow-core/model"
	perfmetrics "github.com/Zer0Echo/tierflow-core/pkg/perf_metrics"
	"github.com/Zer0Echo/tierflow-core/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/shirou/gopsutil/cpu"
	"github.com/shirou/gopsutil/disk"
	"github.com/shirou/gopsutil/host"
	"github.com/shirou/gopsutil/mem"
)

type applianceCPUStatus struct {
	Model              string   `json:"model"`
	LogicalCores       int      `json:"logical_cores"`
	PhysicalCores      int      `json:"physical_cores"`
	UsagePercent       float64  `json:"usage_percent"`
	TemperatureCelsius *float64 `json:"temperature_celsius,omitempty"`
}

type applianceMemoryStatus struct {
	Total       uint64  `json:"total"`
	Used        uint64  `json:"used"`
	Available   uint64  `json:"available"`
	Cached      uint64  `json:"cached"`
	UsedPercent float64 `json:"used_percent"`
}

type applianceGPUStatus struct {
	Index              int      `json:"index"`
	Name               string   `json:"name"`
	UUID               string   `json:"uuid"`
	DriverVersion      string   `json:"driver_version"`
	TemperatureCelsius *float64 `json:"temperature_celsius,omitempty"`
	UtilizationPercent *float64 `json:"utilization_percent,omitempty"`
	MemoryType         string   `json:"memory_type"`
	MemoryTotalBytes   uint64   `json:"memory_total_bytes"`
	MemoryUsedBytes    uint64   `json:"memory_used_bytes"`
	MemoryUsedPercent  float64  `json:"memory_used_percent"`
	PowerDrawWatts     *float64 `json:"power_draw_watts,omitempty"`
	PowerLimitWatts    *float64 `json:"power_limit_watts,omitempty"`
}

type applianceGPUCollection struct {
	Available bool                 `json:"available"`
	Reason    string               `json:"reason,omitempty"`
	Items     []applianceGPUStatus `json:"items"`
}

type applianceApplicationStatus struct {
	Status         string `json:"status"`
	Version        string `json:"version"`
	UptimeSeconds  int64  `json:"uptime_seconds"`
	NodeName       string `json:"node_name"`
	DatabaseStatus string `json:"database_status"`
	Containerized  bool   `json:"containerized"`
	Runtime        string `json:"runtime"`
}

type applianceDeviceStatus struct {
	UpdatedAt       int64                      `json:"updated_at"`
	Hostname        string                     `json:"hostname"`
	Platform        string                     `json:"platform"`
	PlatformVersion string                     `json:"platform_version"`
	KernelVersion   string                     `json:"kernel_version"`
	Architecture    string                     `json:"architecture"`
	UptimeSeconds   uint64                     `json:"uptime_seconds"`
	CPU             applianceCPUStatus         `json:"cpu"`
	Memory          applianceMemoryStatus      `json:"memory"`
	Disk            common.DiskSpaceInfo       `json:"disk"`
	GPUs            applianceGPUCollection     `json:"gpus"`
	Application     applianceApplicationStatus `json:"application"`
}

type applianceModelInstance struct {
	ID             int    `json:"id"`
	Name           string `json:"name"`
	Runtime        string `json:"runtime"`
	Endpoint       string `json:"endpoint"`
	State          string `json:"state"`
	Local          bool   `json:"local"`
	ResponseTimeMs int    `json:"response_time_ms"`
	LastCheckedAt  int64  `json:"last_checked_at"`
}

type applianceModelService struct {
	Name               string                   `json:"name"`
	Description        string                   `json:"description,omitempty"`
	State              string                   `json:"state"`
	DeploymentScope    string                   `json:"deployment_scope"`
	Runtimes           []string                 `json:"runtimes"`
	TotalInstances     int                      `json:"total_instances"`
	AvailableInstances int                      `json:"available_instances"`
	RequestCount       int64                    `json:"request_count_24h"`
	SuccessRate        float64                  `json:"success_rate_24h"`
	AvgLatencyMs       int64                    `json:"avg_latency_ms_24h"`
	AvgTps             float64                  `json:"avg_tps_24h"`
	Instances          []applianceModelInstance `json:"instances"`
}

type applianceModelServicesSummary struct {
	Total        int `json:"total"`
	Running      int `json:"running"`
	Degraded     int `json:"degraded"`
	Stopped      int `json:"stopped"`
	Unconfigured int `json:"unconfigured"`
}

type applianceRoutingPolicy struct {
	Managed                  bool   `json:"managed"`
	Mode                     string `json:"mode"`
	BreakerEnabled           bool   `json:"breaker_enabled"`
	FailureThreshold         int    `json:"failure_threshold"`
	WindowSeconds            int    `json:"window_seconds"`
	CooldownSeconds          int    `json:"cooldown_seconds"`
	MaxCooldownSeconds       int    `json:"max_cooldown_seconds"`
	KeyRotationEnabled       bool   `json:"key_rotation_enabled"`
	MaxKeyRotationsPerRoute  int    `json:"max_key_rotations_per_route"`
	MaxTotalAttemptsPerRoute int    `json:"max_total_attempts_per_route"`
}

type applianceModelServicesData struct {
	UpdatedAt     int                           `json:"updated_at"`
	Hours         int                           `json:"hours"`
	Summary       applianceModelServicesSummary `json:"summary"`
	RoutingPolicy applianceRoutingPolicy        `json:"routing_policy"`
	Services      []applianceModelService       `json:"services"`
}

func GetApplianceDeviceStatus(c *gin.Context) {
	device, err := collectApplianceDeviceStatus()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, device)
}

func GetApplianceModelServices(c *gin.Context) {
	hours := 24
	if value := c.Query("hours"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 && parsed <= 24*30 {
			hours = parsed
		}
	}
	data, err := collectApplianceModelServices(hours)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, data)
}

func collectApplianceDeviceStatus() (applianceDeviceStatus, error) {
	hostInfo, hostErr := host.Info()
	memoryInfo, memoryErr := mem.VirtualMemory()
	if memoryErr != nil {
		return applianceDeviceStatus{}, memoryErr
	}

	logicalCores, _ := cpu.Counts(true)
	physicalCores, _ := cpu.Counts(false)
	if logicalCores <= 0 {
		logicalCores = runtime.NumCPU()
	}
	if physicalCores <= 0 {
		physicalCores = logicalCores
	}
	usage := 0.0
	if percentages, err := cpu.Percent(200*time.Millisecond, false); err == nil && len(percentages) > 0 {
		usage = percentages[0]
	}
	modelName := readCPUModel()

	hostname := strings.TrimSpace(os.Getenv("APPLIANCE_HOSTNAME"))
	platform := strings.TrimSpace(os.Getenv("APPLIANCE_HOST_OS"))
	platformFromEnvironment := platform != ""
	platformVersion := ""
	kernelVersion := ""
	architecture := runtime.GOARCH
	uptime := uint64(0)
	if hostErr == nil && hostInfo != nil {
		if hostname == "" {
			hostname = hostInfo.Hostname
		}
		if platform == "" {
			platform = hostInfo.Platform
		}
		if !platformFromEnvironment {
			platformVersion = hostInfo.PlatformVersion
		}
		kernelVersion = hostInfo.KernelVersion
		if hostInfo.KernelArch != "" {
			architecture = hostInfo.KernelArch
		}
		uptime = hostInfo.Uptime
	}
	if hostname == "" {
		hostname, _ = os.Hostname()
	}

	databaseStatus := "running"
	if err := model.PingDB(); err != nil {
		databaseStatus = "error"
	}
	nodeName := common.NodeName
	if nodeName == "" {
		nodeName = hostname
	}
	runtimeName := "native"
	if common.IsRunningInContainer() {
		runtimeName = "container"
	}

	return applianceDeviceStatus{
		UpdatedAt:       time.Now().Unix(),
		Hostname:        hostname,
		Platform:        platform,
		PlatformVersion: platformVersion,
		KernelVersion:   kernelVersion,
		Architecture:    architecture,
		UptimeSeconds:   uptime,
		CPU: applianceCPUStatus{
			Model:              modelName,
			LogicalCores:       logicalCores,
			PhysicalCores:      physicalCores,
			UsagePercent:       usage,
			TemperatureCelsius: readCPUTemperature(),
		},
		Memory: applianceMemoryStatus{
			Total:       memoryInfo.Total,
			Used:        memoryInfo.Used,
			Available:   memoryInfo.Available,
			Cached:      memoryInfo.Cached,
			UsedPercent: memoryInfo.UsedPercent,
		},
		Disk: getApplianceDiskSpace(),
		GPUs: queryNvidiaGPUs(),
		Application: applianceApplicationStatus{
			Status:         "running",
			Version:        common.Version,
			UptimeSeconds:  time.Now().Unix() - common.StartTime,
			NodeName:       nodeName,
			DatabaseStatus: databaseStatus,
			Containerized:  common.IsRunningInContainer(),
			Runtime:        runtimeName,
		},
	}, nil
}

func getApplianceDiskSpace() common.DiskSpaceInfo {
	path := strings.TrimSpace(os.Getenv("APPLIANCE_DATA_PATH"))
	if path == "" {
		path = "/data"
	}
	usage, err := disk.Usage(path)
	if err != nil {
		return common.GetDiskSpaceInfo()
	}
	return common.DiskSpaceInfo{
		Total:       usage.Total,
		Free:        usage.Free,
		Used:        usage.Used,
		UsedPercent: usage.UsedPercent,
	}
}

func readCPUTemperature() *float64 {
	temperatures, err := host.SensorsTemperatures()
	if err != nil {
		return nil
	}
	var preferred *float64
	var fallback *float64
	for _, temperature := range temperatures {
		key := strings.ToLower(temperature.SensorKey)
		if !isLiveTemperatureSensor(key) {
			continue
		}
		if temperature.Temperature <= 0 || temperature.Temperature > 125 {
			continue
		}
		value := temperature.Temperature
		if fallback == nil || value > *fallback {
			fallback = &value
		}
		if strings.Contains(key, "cpu") || strings.Contains(key, "core") || strings.Contains(key, "package") || strings.Contains(key, "soc") || strings.Contains(key, "thermal") || strings.Contains(key, "k10temp") || strings.Contains(key, "acpi") {
			if preferred == nil || value > *preferred {
				preferred = &value
			}
		}
	}
	if preferred != nil {
		return preferred
	}
	return fallback
}

func isLiveTemperatureSensor(key string) bool {
	for _, marker := range []string{"crit", "max", "min", "alarm", "emergency", "highest", "lowest"} {
		if strings.Contains(key, marker) {
			return false
		}
	}
	return true
}

func readCPUModel() string {
	if configured := strings.TrimSpace(os.Getenv("APPLIANCE_CPU_MODEL")); configured != "" {
		return configured
	}

	models := make([]string, 0, 2)
	if cpuInfo, err := cpu.Info(); err == nil {
		for _, info := range cpuInfo {
			models = appendUniqueNonEmpty(models, info.ModelName)
		}
	}
	if len(models) > 0 {
		return strings.Join(models, " + ")
	}

	path, err := exec.LookPath("lscpu")
	if err == nil {
		command := exec.Command(path)
		command.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
		if output, commandErr := command.Output(); commandErr == nil {
			models = parseLSCPUModelNames(string(output))
			if len(models) > 0 {
				return strings.Join(models, " + ")
			}
		}
	}

	if runtime.GOARCH == "arm64" {
		return "ARM64 processor"
	}
	return runtime.GOARCH + " processor"
}

func parseLSCPUModelNames(output string) []string {
	models := make([]string, 0, 2)
	for _, line := range strings.Split(output, "\n") {
		key, value, found := strings.Cut(line, ":")
		if !found || !strings.EqualFold(strings.TrimSpace(key), "Model name") {
			continue
		}
		models = appendUniqueNonEmpty(models, value)
	}
	return models
}

func appendUniqueNonEmpty(values []string, candidate string) []string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return values
	}
	for _, value := range values {
		if strings.EqualFold(value, candidate) {
			return values
		}
	}
	return append(values, candidate)
}

func queryNvidiaGPUs() applianceGPUCollection {
	path, err := exec.LookPath("nvidia-smi")
	if err != nil {
		return applianceGPUCollection{Available: false, Reason: "nvidia-smi is not available in this environment", Items: []applianceGPUStatus{}}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path,
		"--query-gpu=index,name,uuid,driver_version,temperature.gpu,utilization.gpu,memory.total,memory.used,power.draw,power.limit",
		"--format=csv,noheader,nounits",
	).Output()
	if err != nil {
		reason := "nvidia-smi did not return GPU metrics"
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			reason = "nvidia-smi timed out"
		}
		return applianceGPUCollection{Available: false, Reason: reason, Items: []applianceGPUStatus{}}
	}
	items, err := parseNvidiaGPUCSV(strings.NewReader(string(output)))
	if err != nil || len(items) == 0 {
		return applianceGPUCollection{Available: false, Reason: "no NVIDIA GPU was detected", Items: []applianceGPUStatus{}}
	}
	for index := range items {
		if items[index].MemoryTotalBytes > 0 {
			continue
		}
		memoryTotalBytes, memoryUsedBytes, ok := queryCUDAUnifiedMemory(items[index].Index)
		if !ok {
			continue
		}
		items[index].MemoryType = "unified"
		items[index].MemoryTotalBytes = memoryTotalBytes
		items[index].MemoryUsedBytes = memoryUsedBytes
		items[index].MemoryUsedPercent = float64(memoryUsedBytes) / float64(memoryTotalBytes) * 100
	}
	return applianceGPUCollection{Available: true, Items: items}
}

func parseNvidiaGPUCSV(reader io.Reader) ([]applianceGPUStatus, error) {
	records, err := csv.NewReader(reader).ReadAll()
	if err != nil {
		return nil, err
	}
	items := make([]applianceGPUStatus, 0, len(records))
	for _, record := range records {
		if len(record) < 10 {
			continue
		}
		index, err := strconv.Atoi(strings.TrimSpace(record[0]))
		if err != nil {
			continue
		}
		memoryTotalMB := parseMetricFloat(record[6])
		memoryUsedMB := parseMetricFloat(record[7])
		item := applianceGPUStatus{
			Index:              index,
			Name:               strings.TrimSpace(record[1]),
			UUID:               strings.TrimSpace(record[2]),
			DriverVersion:      strings.TrimSpace(record[3]),
			TemperatureCelsius: metricFloatPointer(record[4]),
			UtilizationPercent: metricFloatPointer(record[5]),
			MemoryType:         "unavailable",
			PowerDrawWatts:     metricFloatPointer(record[8]),
			PowerLimitWatts:    metricFloatPointer(record[9]),
		}
		if memoryTotalMB != nil {
			item.MemoryType = "dedicated"
			item.MemoryTotalBytes = uint64(*memoryTotalMB * 1024 * 1024)
		}
		if memoryUsedMB != nil {
			item.MemoryUsedBytes = uint64(*memoryUsedMB * 1024 * 1024)
		}
		if item.MemoryTotalBytes > 0 {
			item.MemoryUsedPercent = float64(item.MemoryUsedBytes) / float64(item.MemoryTotalBytes) * 100
		}
		items = append(items, item)
	}
	return items, nil
}

func queryCUDAUnifiedMemory(index int) (uint64, uint64, bool) {
	path, err := exec.LookPath("tierflow-cuda-memory")
	if err != nil {
		return 0, 0, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, strconv.Itoa(index)).Output()
	if err != nil {
		return 0, 0, false
	}
	return parseCUDAUnifiedMemoryOutput(string(output))
}

func parseCUDAUnifiedMemoryOutput(output string) (uint64, uint64, bool) {
	fields := strings.Fields(output)
	if len(fields) < 2 {
		return 0, 0, false
	}
	totalBytes, totalErr := strconv.ParseUint(fields[0], 10, 64)
	freeBytes, freeErr := strconv.ParseUint(fields[1], 10, 64)
	if totalErr != nil || freeErr != nil || totalBytes == 0 || freeBytes > totalBytes {
		return 0, 0, false
	}
	return totalBytes, totalBytes - freeBytes, true
}

func metricFloatPointer(value string) *float64 {
	return parseMetricFloat(value)
}

func parseMetricFloat(value string) *float64 {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, "N/A") || strings.EqualFold(value, "[Not Supported]") {
		return nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func collectApplianceModelServices(hours int) (applianceModelServicesData, error) {
	var channels []*model.Channel
	if err := model.DB.Omit("key").Find(&channels).Error; err != nil {
		return applianceModelServicesData{}, err
	}
	var abilities []model.Ability
	if err := model.DB.Find(&abilities).Error; err != nil {
		return applianceModelServicesData{}, err
	}
	var metadata []*model.Model
	if err := model.DB.Find(&metadata).Error; err != nil {
		return applianceModelServicesData{}, err
	}

	healthModels, _ := model.BuildRouteHealth()
	healthByModel := make(map[string]model.ModelHealth, len(healthModels))
	healthByChannel := make(map[int]model.ProviderHealth)
	for _, healthModel := range healthModels {
		healthByModel[healthModel.Model] = healthModel
		for _, provider := range healthModel.Channels {
			healthByChannel[provider.ChannelId] = provider
		}
	}
	metrics, err := perfmetrics.QuerySummaryAll(hours, nil)
	if err != nil {
		return applianceModelServicesData{}, err
	}
	metricsByModel := make(map[string]perfmetrics.ModelSummary, len(metrics.Models))
	for _, metric := range metrics.Models {
		metricsByModel[metric.ModelName] = metric
	}

	channelByID := make(map[int]*model.Channel, len(channels))
	for _, channel := range channels {
		channelByID[channel.Id] = channel
	}
	metadataByName := make(map[string]*model.Model, len(metadata))
	serviceNames := make(map[string]struct{})
	for _, item := range metadata {
		metadataByName[item.ModelName] = item
		serviceNames[item.ModelName] = struct{}{}
	}
	abilitiesByModel := make(map[string][]model.Ability)
	for _, ability := range abilities {
		abilitiesByModel[ability.Model] = append(abilitiesByModel[ability.Model], ability)
		serviceNames[ability.Model] = struct{}{}
	}

	names := make([]string, 0, len(serviceNames))
	for name := range serviceNames {
		names = append(names, name)
	}
	sort.Strings(names)
	services := make([]applianceModelService, 0, len(names))
	summary := applianceModelServicesSummary{Total: len(names)}
	for _, name := range names {
		service := applianceModelService{Name: name, State: "unconfigured", Instances: []applianceModelInstance{}, Runtimes: []string{}}
		if item := metadataByName[name]; item != nil {
			service.Description = item.Description
			if item.Status == 0 {
				service.State = "stopped"
			}
		}
		seenChannels := make(map[int]struct{})
		runtimeSet := make(map[string]struct{})
		localCount := 0
		for _, ability := range abilitiesByModel[name] {
			if _, exists := seenChannels[ability.ChannelId]; exists {
				continue
			}
			seenChannels[ability.ChannelId] = struct{}{}
			channel := channelByID[ability.ChannelId]
			if channel == nil {
				continue
			}
			endpoint := channel.GetBaseURL()
			local := isLocalInferenceEndpoint(channel.Type, endpoint)
			if local {
				localCount++
			}
			runtimeLabel := constant.GetChannelTypeName(channel.Type)
			runtimeSet[runtimeLabel] = struct{}{}
			state := "running"
			if channel.Status != common.ChannelStatusEnabled || !ability.Enabled {
				state = "stopped"
			} else if provider, ok := healthByChannel[channel.Id]; ok {
				switch provider.State {
				case "cooling":
					state = "unavailable"
				case "degraded", "probing":
					state = "degraded"
				}
			}
			if state == "running" || state == "degraded" {
				service.AvailableInstances++
			}
			service.Instances = append(service.Instances, applianceModelInstance{
				ID:             channel.Id,
				Name:           channel.Name,
				Runtime:        runtimeLabel,
				Endpoint:       endpoint,
				State:          state,
				Local:          local,
				ResponseTimeMs: channel.ResponseTime,
				LastCheckedAt:  channel.TestTime,
			})
		}
		service.TotalInstances = len(service.Instances)
		for runtimeLabel := range runtimeSet {
			service.Runtimes = append(service.Runtimes, runtimeLabel)
		}
		sort.Strings(service.Runtimes)
		switch {
		case service.TotalInstances == 0:
			service.DeploymentScope = "unconfigured"
		case localCount == service.TotalInstances:
			service.DeploymentScope = "local"
		case localCount == 0:
			service.DeploymentScope = "external"
		default:
			service.DeploymentScope = "mixed"
		}
		if metadataItem := metadataByName[name]; metadataItem == nil || metadataItem.Status != 0 {
			health := healthByModel[name]
			switch {
			case service.TotalInstances == 0:
				service.State = "unconfigured"
			case service.AvailableInstances == 0:
				service.State = "stopped"
			case health.State == "degraded" || service.AvailableInstances < service.TotalInstances:
				service.State = "degraded"
			default:
				service.State = "running"
			}
		}
		if metric, ok := metricsByModel[name]; ok {
			service.RequestCount = metric.RequestCount
			service.SuccessRate = metric.SuccessRate
			service.AvgLatencyMs = metric.AvgLatencyMs
			service.AvgTps = metric.AvgTps
		}
		sort.Slice(service.Instances, func(i, j int) bool {
			return service.Instances[i].Name < service.Instances[j].Name
		})
		switch service.State {
		case "running":
			summary.Running++
		case "degraded":
			summary.Degraded++
		case "unconfigured":
			summary.Unconfigured++
		default:
			summary.Stopped++
		}
		services = append(services, service)
	}

	sort.SliceStable(services, func(i, j int) bool {
		return modelServiceStateRank(services[i].State) < modelServiceStateRank(services[j].State)
	})
	return applianceModelServicesData{
		UpdatedAt:     int(time.Now().Unix()),
		Hours:         hours,
		Summary:       summary,
		RoutingPolicy: getApplianceRoutingPolicy(),
		Services:      services,
	}, nil
}

func getApplianceRoutingPolicy() applianceRoutingPolicy {
	return applianceRoutingPolicy{
		Managed:                  true,
		Mode:                     "appliance_managed",
		BreakerEnabled:           operation_setting.RouteBreakerEnabled,
		FailureThreshold:         operation_setting.RouteBreakerFailureThreshold,
		WindowSeconds:            operation_setting.RouteBreakerWindowSeconds,
		CooldownSeconds:          operation_setting.RouteBreakerCooldownSeconds,
		MaxCooldownSeconds:       operation_setting.RouteBreakerMaxCooldownSecs,
		KeyRotationEnabled:       operation_setting.RouteKeyRotationEnabled,
		MaxKeyRotationsPerRoute:  operation_setting.RouteKeyRotationMaxPerChannel,
		MaxTotalAttemptsPerRoute: operation_setting.RouteMaxTotalAttempts,
	}
}

func modelServiceStateRank(state string) int {
	switch state {
	case "stopped":
		return 0
	case "degraded":
		return 1
	case "unconfigured":
		return 2
	default:
		return 3
	}
}

func isLocalInferenceEndpoint(channelType int, endpoint string) bool {
	if channelType == constant.ChannelTypeOllama || channelType == constant.ChannelTypeXinference {
		return true
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname == "localhost" || hostname == "host.docker.internal" || strings.HasSuffix(hostname, ".local") {
		return true
	}
	if ip := net.ParseIP(hostname); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate()
	}
	return hostname != "" && !strings.Contains(hostname, ".")
}
