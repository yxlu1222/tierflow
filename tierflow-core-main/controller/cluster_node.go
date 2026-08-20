package controller

import (
	"bytes"
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"github.com/Zer0Echo/tierflow-core/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type clusterMemoryStatus struct {
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
}

type clusterCPUStatus struct {
	UsagePercent float64 `json:"usage_percent"`
}

type clusterCUDAStatus struct {
	Available          bool    `json:"available"`
	Name               string  `json:"name"`
	UtilizationPercent float64 `json:"utilization_percent"`
	MemoryTotalBytes   uint64  `json:"memory_total_bytes"`
	MemoryUsedBytes    uint64  `json:"memory_used_bytes"`
	UnifiedMemoryBytes uint64  `json:"unified_memory_bytes"`
}

type clusterDiskStatus struct {
	Path           string `json:"path"`
	TotalBytes     uint64 `json:"total_bytes"`
	AvailableBytes uint64 `json:"available_bytes"`
	UsedBytes      uint64 `json:"used_bytes"`
}

type ClusterModelStatus struct {
	ID              string `json:"id"`
	DisplayName     string `json:"display_name"`
	Service         string `json:"service"`
	Endpoint        string `json:"endpoint"`
	ChannelID       int    `json:"channel_id"`
	State           string `json:"state"`
	SubState        string `json:"sub_state"`
	MainPID         int64  `json:"main_pid"`
	MemoryBytes     uint64 `json:"memory_bytes"`
	EndpointHealthy bool   `json:"endpoint_healthy"`
	ManifestPresent bool   `json:"manifest_present"`
}

type clusterHeartbeatRequest struct {
	NodeName     string               `json:"node_name"`
	Hostname     string               `json:"hostname"`
	Role         string               `json:"role"`
	AgentURL     string               `json:"agent_url"`
	AgentVersion string               `json:"agent_version"`
	Draining     bool                 `json:"draining"`
	CPU          clusterCPUStatus     `json:"cpu"`
	Memory       clusterMemoryStatus  `json:"memory"`
	CUDA         clusterCUDAStatus    `json:"cuda"`
	Disk         clusterDiskStatus    `json:"disk"`
	Models       []ClusterModelStatus `json:"models"`
	CollectedAt  int64                `json:"collected_at"`
}

type clusterNodeInput struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	Role     string `json:"role"`
	AgentURL string `json:"agent_url"`
	FabricIP string `json:"fabric_ip"`
	WifiIP   string `json:"wifi_ip"`
	Draining *bool  `json:"draining,omitempty"`
}

type clusterNodeView struct {
	*model.ClusterNode
	Models []ClusterModelStatus `json:"models"`
	Stale  bool                 `json:"stale"`
}

type clusterActionRequest struct {
	Action string `json:"action"`
}

type clusterDrainRequest struct {
	Draining bool `json:"draining"`
}

var (
	clusterMonitorOnce sync.Once
	clusterHTTPClient  = &http.Client{
		Timeout: 15 * time.Minute,
		Transport: &http.Transport{
			DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		},
	}
)

func clusterAgentToken() (string, error) {
	if path := strings.TrimSpace(os.Getenv("CLUSTER_AGENT_TOKEN_FILE")); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", err
		}
		token := strings.TrimSpace(string(data))
		if token == "" {
			return "", errors.New("cluster agent token file is empty")
		}
		return token, nil
	}
	token := strings.TrimSpace(os.Getenv("CLUSTER_AGENT_TOKEN"))
	if token == "" {
		return "", errors.New("CLUSTER_AGENT_TOKEN or CLUSTER_AGENT_TOKEN_FILE is not configured")
	}
	return token, nil
}

func authorizeClusterHeartbeat(c *gin.Context) bool {
	expected, err := clusterAgentToken()
	if err != nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": err.Error()})
		return false
	}
	header := c.GetHeader("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "unauthorized"})
		return false
	}
	provided := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if len(provided) != len(expected) || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"success": false, "message": "unauthorized"})
		return false
	}
	return true
}

func normalizeAgentURL(raw string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" {
		return "", "", errors.New("invalid agent_url")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", "", errors.New("agent_url must use http or https")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", "", errors.New("agent_url must not contain credentials, query or fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	host := parsed.Hostname()
	if net.ParseIP(host) == nil && strings.TrimSpace(host) == "" {
		return "", "", errors.New("agent_url has no host")
	}
	return strings.TrimRight(parsed.String(), "/"), host, nil
}

func ClusterHeartbeat(c *gin.Context) {
	if !authorizeClusterHeartbeat(c) {
		return
	}
	var heartbeat clusterHeartbeatRequest
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 2*1024*1024), &heartbeat); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	heartbeat.NodeName = strings.TrimSpace(heartbeat.NodeName)
	if heartbeat.NodeName == "" || (heartbeat.Role != "controller" && heartbeat.Role != "worker") {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid node_name or role"})
		return
	}
	agentURL, fabricIP, err := normalizeAgentURL(heartbeat.AgentURL)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	modelsJSON, err := common.Marshal(heartbeat.Models)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	previousNode, previousErr := model.GetClusterNodeByName(heartbeat.NodeName)
	if previousErr != nil && !errors.Is(previousErr, gorm.ErrRecordNotFound) {
		common.ApiError(c, previousErr)
		return
	}
	node, err := model.UpsertClusterNodeHeartbeat(&model.ClusterNode{
		Name:                   heartbeat.NodeName,
		Hostname:               heartbeat.Hostname,
		Role:                   heartbeat.Role,
		AgentURL:               agentURL,
		FabricIP:               fabricIP,
		Status:                 "online",
		Draining:               heartbeat.Draining,
		AgentVersion:           heartbeat.AgentVersion,
		CPUUsagePercent:        heartbeat.CPU.UsagePercent,
		MemoryTotalBytes:       heartbeat.Memory.TotalBytes,
		MemoryAvailableBytes:   heartbeat.Memory.AvailableBytes,
		CUDAAvailable:          heartbeat.CUDA.Available,
		CUDAName:               heartbeat.CUDA.Name,
		CUDAUtilizationPercent: heartbeat.CUDA.UtilizationPercent,
		CUDAMemoryTotalBytes:   heartbeat.CUDA.MemoryTotalBytes,
		CUDAMemoryUsedBytes:    heartbeat.CUDA.MemoryUsedBytes,
		CUDAUnifiedMemoryBytes: heartbeat.CUDA.UnifiedMemoryBytes,
		DiskTotalBytes:         heartbeat.Disk.TotalBytes,
		DiskAvailableBytes:     heartbeat.Disk.AvailableBytes,
		ModelsJSON:             string(modelsJSON),
		LastSeenAt:             time.Now().Unix(),
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if previousNode != nil {
		syncRemovedClusterModelChannels(previousNode.ModelsJSON, heartbeat.Models)
	}
	syncClusterModelChannels(heartbeat.Models, true, heartbeat.Draining, "node heartbeat")
	common.ApiSuccess(c, gin.H{"node_id": node.Id, "received_at": time.Now().Unix()})
}

func nodeView(node *model.ClusterNode) clusterNodeView {
	models := make([]ClusterModelStatus, 0)
	if node.ModelsJSON != "" {
		_ = common.Unmarshal([]byte(node.ModelsJSON), &models)
	}
	timeout := clusterNodeTimeout()
	stale := node.LastSeenAt == 0 || node.LastSeenAt < time.Now().Add(-timeout).Unix()
	copyNode := *node
	if stale {
		copyNode.Status = "offline"
	}
	return clusterNodeView{ClusterNode: &copyNode, Models: models, Stale: stale}
}

func GetClusterNodes(c *gin.Context) {
	nodes, err := model.GetAllClusterNodes()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]clusterNodeView, 0, len(nodes))
	for _, node := range nodes {
		views = append(views, nodeView(node))
	}
	common.ApiSuccess(c, views)
}

func GetClusterNode(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nodeView(node))
}

func CreateClusterNode(c *gin.Context) {
	var input clusterNodeInput
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1024*1024), &input); err != nil {
		common.ApiError(c, err)
		return
	}
	agentURL, _, err := normalizeAgentURL(input.AgentURL)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	node := &model.ClusterNode{Name: input.Name, Hostname: input.Hostname, Role: input.Role, AgentURL: agentURL, FabricIP: input.FabricIP, WifiIP: input.WifiIP, Status: "offline"}
	if input.Draining != nil {
		node.Draining = *input.Draining
	}
	if err := model.CreateClusterNode(node); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nodeView(node))
}

func UpdateClusterNode(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var input clusterNodeInput
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1024*1024), &input); err != nil {
		common.ApiError(c, err)
		return
	}
	updates := make(map[string]any)
	if strings.TrimSpace(input.Name) != "" {
		updates["name"] = strings.TrimSpace(input.Name)
	}
	if input.Hostname != "" {
		updates["hostname"] = strings.TrimSpace(input.Hostname)
	}
	if input.Role != "" {
		if input.Role != "controller" && input.Role != "worker" {
			common.ApiErrorMsg(c, "role must be controller or worker")
			return
		}
		updates["role"] = input.Role
	}
	if input.AgentURL != "" {
		agentURL, _, err := normalizeAgentURL(input.AgentURL)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		updates["agent_url"] = agentURL
	}
	if input.FabricIP != "" {
		updates["fabric_ip"] = strings.TrimSpace(input.FabricIP)
	}
	if input.WifiIP != "" {
		updates["wifi_ip"] = strings.TrimSpace(input.WifiIP)
	}
	if input.Draining != nil {
		updates["draining"] = *input.Draining
	}
	if err := model.UpdateClusterNodeConfiguration(node.Id, updates); err != nil {
		common.ApiError(c, err)
		return
	}
	updated, _ := model.GetClusterNodeById(node.Id)
	common.ApiSuccess(c, nodeView(updated))
}

func DeleteClusterNode(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	syncClusterModelChannels(parseClusterModels(node.ModelsJSON), false, node.Draining, "cluster node deleted")
	if err := model.DeleteClusterNodeById(node.Id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": node.Id})
}

func clusterNodeFromParam(c *gin.Context) (*model.ClusterNode, error) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		return nil, errors.New("invalid node id")
	}
	return model.GetClusterNodeById(id)
}

func clusterAgentRequest(node *model.ClusterNode, method, path string, body any) (any, error) {
	baseURL, _, err := normalizeAgentURL(node.AgentURL)
	if err != nil {
		return nil, err
	}
	var reader io.Reader
	if body != nil {
		data, err := common.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	request, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	token, err := clusterAgentToken()
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := clusterHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	var result any
	if len(data) > 0 {
		if err := common.Unmarshal(data, &result); err != nil {
			return nil, fmt.Errorf("agent returned invalid JSON: %w", err)
		}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("agent returned %s: %s", response.Status, strings.TrimSpace(string(data)))
	}
	return result, nil
}

func ClusterNodeDrain(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var input clusterDrainRequest
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1024*1024), &input); err != nil {
		common.ApiError(c, err)
		return
	}
	result, err := clusterAgentRequest(node, http.MethodPost, "/v1/drain", input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	_ = model.UpdateClusterNodeConfiguration(node.Id, map[string]any{"draining": input.Draining})
	models := parseClusterModels(node.ModelsJSON)
	syncClusterModelChannels(models, true, input.Draining, "node drain state changed")
	common.ApiSuccess(c, result)
}

func ClusterNodeModelAction(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	modelID := c.Param("model")
	if !safeClusterModelID(modelID) {
		common.ApiErrorMsg(c, "invalid model id")
		return
	}
	var input clusterActionRequest
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1024*1024), &input); err != nil {
		common.ApiError(c, err)
		return
	}
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	if input.Action != "start" && input.Action != "stop" && input.Action != "restart" {
		common.ApiErrorMsg(c, "action must be start, stop or restart")
		return
	}
	result, err := clusterAgentRequest(node, http.MethodPost, "/v1/models/"+url.PathEscape(modelID)+"/actions", input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	for _, status := range parseClusterModels(node.ModelsJSON) {
		if status.ID != modelID || status.ChannelID <= 0 {
			continue
		}
		if input.Action == "start" || input.Action == "restart" {
			// An explicit administrator start transfers the channel from a
			// manually-disabled state into controller-managed automatic state.
			// The next healthy heartbeat is then allowed to enable it.
			model.UpdateChannelStatus(status.ChannelID, "", common.ChannelStatusAutoDisabled, "model is starting on cluster node")
		} else {
			model.SyncClusterManagedChannelStatus(status.ChannelID, false, "model stopped by cluster administrator")
		}
		break
	}
	common.ApiSuccess(c, result)
}

func ClusterNodeModelLogs(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	modelID := c.Param("model")
	if !safeClusterModelID(modelID) {
		common.ApiErrorMsg(c, "invalid model id")
		return
	}
	lines, _ := strconv.Atoi(c.Query("lines"))
	if lines <= 0 {
		lines = 200
	}
	if lines > 2000 {
		lines = 2000
	}
	result, err := clusterAgentRequest(node, http.MethodGet, "/v1/models/"+url.PathEscape(modelID)+"/logs?lines="+strconv.Itoa(lines), nil)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func ClusterNodeModelVerify(c *gin.Context) {
	node, err := clusterNodeFromParam(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	modelID := c.Param("model")
	if !safeClusterModelID(modelID) {
		common.ApiErrorMsg(c, "invalid model id")
		return
	}
	result, err := clusterAgentRequest(node, http.MethodPost, "/v1/models/"+url.PathEscape(modelID)+"/verify", gin.H{})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func safeClusterModelID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	for _, char := range id {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '.' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func parseClusterModels(raw string) []ClusterModelStatus {
	models := make([]ClusterModelStatus, 0)
	if raw != "" {
		_ = common.Unmarshal([]byte(raw), &models)
	}
	return models
}

func syncClusterModelChannels(models []ClusterModelStatus, online, draining bool, reason string) {
	for _, status := range models {
		available := online && !draining && status.State == "active" && status.EndpointHealthy
		model.SyncClusterManagedChannelStatus(status.ChannelID, available, reason)
	}
}

func syncRemovedClusterModelChannels(previousRaw string, current []ClusterModelStatus) {
	currentChannels := make(map[int]struct{}, len(current))
	for _, status := range current {
		if status.ChannelID > 0 {
			currentChannels[status.ChannelID] = struct{}{}
		}
	}
	for _, status := range parseClusterModels(previousRaw) {
		if status.ChannelID <= 0 {
			continue
		}
		if _, ok := currentChannels[status.ChannelID]; !ok {
			model.SyncClusterManagedChannelStatus(status.ChannelID, false, "model removed from cluster node configuration")
		}
	}
}

func clusterNodeTimeout() time.Duration {
	seconds, err := strconv.Atoi(strings.TrimSpace(os.Getenv("CLUSTER_NODE_TIMEOUT_SECONDS")))
	if err != nil || seconds < 15 {
		seconds = 45
	}
	return time.Duration(seconds) * time.Second
}

func StartClusterNodeMonitor() {
	clusterMonitorOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for range ticker.C {
				markStaleClusterNodes()
			}
		}()
	})
}

func markStaleClusterNodes() {
	nodes, err := model.GetStaleClusterNodes(model.ClusterNodeOfflineCutoff(clusterNodeTimeout()))
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		common.SysError("failed to query stale cluster nodes: " + err.Error())
		return
	}
	for _, node := range nodes {
		if err := model.MarkClusterNodeOffline(node.Id); err != nil {
			common.SysError("failed to mark cluster node offline: " + err.Error())
			continue
		}
		syncClusterModelChannels(parseClusterModels(node.ModelsJSON), false, node.Draining, "cluster node heartbeat timed out")
	}
}
