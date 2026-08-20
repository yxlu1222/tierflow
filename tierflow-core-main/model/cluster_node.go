package model

import (
	"errors"
	"strings"
	"time"

	"github.com/Zer0Echo/tierflow-core/common"
	"gorm.io/gorm"
)

// ClusterNode is a machine managed by the TierFlow controller. Runtime model
// state is reported by the node agent and stored as JSON text so migrations
// remain compatible with SQLite, MySQL and PostgreSQL.
type ClusterNode struct {
	Id                     int     `json:"id" gorm:"primaryKey"`
	Name                   string  `json:"name" gorm:"type:varchar(128);uniqueIndex"`
	Hostname               string  `json:"hostname" gorm:"type:varchar(255)"`
	Role                   string  `json:"role" gorm:"type:varchar(32);default:'worker'"`
	AgentURL               string  `json:"agent_url" gorm:"column:agent_url;type:varchar(512)"`
	FabricIP               string  `json:"fabric_ip" gorm:"column:fabric_ip;type:varchar(64)"`
	WifiIP                 string  `json:"wifi_ip" gorm:"column:wifi_ip;type:varchar(64)"`
	Status                 string  `json:"status" gorm:"type:varchar(32);default:'offline';index"`
	Draining               bool    `json:"draining" gorm:"default:false"`
	AgentVersion           string  `json:"agent_version" gorm:"type:varchar(32)"`
	CPUUsagePercent        float64 `json:"cpu_usage_percent" gorm:"column:cpu_usage_percent"`
	MemoryTotalBytes       uint64  `json:"memory_total_bytes"`
	MemoryAvailableBytes   uint64  `json:"memory_available_bytes"`
	CUDAAvailable          bool    `json:"cuda_available" gorm:"column:cuda_available;default:false"`
	CUDAName               string  `json:"cuda_name" gorm:"column:cuda_name;type:varchar(255)"`
	CUDAUtilizationPercent float64 `json:"cuda_utilization_percent" gorm:"column:cuda_utilization_percent"`
	CUDAMemoryTotalBytes   uint64  `json:"cuda_memory_total_bytes" gorm:"column:cuda_memory_total_bytes"`
	CUDAMemoryUsedBytes    uint64  `json:"cuda_memory_used_bytes" gorm:"column:cuda_memory_used_bytes"`
	CUDAUnifiedMemoryBytes uint64  `json:"cuda_unified_memory_bytes" gorm:"column:cuda_unified_memory_bytes"`
	DiskTotalBytes         uint64  `json:"disk_total_bytes"`
	DiskAvailableBytes     uint64  `json:"disk_available_bytes"`
	ModelsJSON             string  `json:"-" gorm:"column:models_json;type:text"`
	LastSeenAt             int64   `json:"last_seen_at" gorm:"index"`
	CreatedTime            int64   `json:"created_time" gorm:"autoCreateTime"`
	UpdatedTime            int64   `json:"updated_time" gorm:"autoUpdateTime"`
}

func GetAllClusterNodes() ([]*ClusterNode, error) {
	var nodes []*ClusterNode
	err := DB.Order("id asc").Find(&nodes).Error
	return nodes, err
}

func GetClusterNodeById(id int) (*ClusterNode, error) {
	var node ClusterNode
	if err := DB.First(&node, id).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func GetClusterNodeByName(name string) (*ClusterNode, error) {
	var node ClusterNode
	if err := DB.Where("name = ?", name).First(&node).Error; err != nil {
		return nil, err
	}
	return &node, nil
}

func CreateClusterNode(node *ClusterNode) error {
	node.Name = strings.TrimSpace(node.Name)
	if node.Name == "" {
		return errors.New("node name is required")
	}
	if node.Role == "" {
		node.Role = "worker"
	}
	if node.Status == "" {
		node.Status = "offline"
	}
	return DB.Create(node).Error
}

func UpdateClusterNodeConfiguration(id int, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	result := DB.Model(&ClusterNode{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	return nil
}

func DeleteClusterNodeById(id int) error {
	result := DB.Delete(&ClusterNode{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func UpsertClusterNodeHeartbeat(node *ClusterNode) (*ClusterNode, error) {
	var existing ClusterNode
	err := DB.Where("name = ?", node.Name).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		if err := CreateClusterNode(node); err != nil {
			return nil, err
		}
		return node, nil
	}
	if err != nil {
		return nil, err
	}
	updates := map[string]any{
		"hostname":                  node.Hostname,
		"role":                      node.Role,
		"agent_url":                 node.AgentURL,
		"fabric_ip":                 node.FabricIP,
		"status":                    node.Status,
		"draining":                  node.Draining,
		"agent_version":             node.AgentVersion,
		"cpu_usage_percent":         node.CPUUsagePercent,
		"memory_total_bytes":        node.MemoryTotalBytes,
		"memory_available_bytes":    node.MemoryAvailableBytes,
		"cuda_available":            node.CUDAAvailable,
		"cuda_name":                 node.CUDAName,
		"cuda_utilization_percent":  node.CUDAUtilizationPercent,
		"cuda_memory_total_bytes":   node.CUDAMemoryTotalBytes,
		"cuda_memory_used_bytes":    node.CUDAMemoryUsedBytes,
		"cuda_unified_memory_bytes": node.CUDAUnifiedMemoryBytes,
		"disk_total_bytes":          node.DiskTotalBytes,
		"disk_available_bytes":      node.DiskAvailableBytes,
		"models_json":               node.ModelsJSON,
		"last_seen_at":              node.LastSeenAt,
	}
	if err := DB.Model(&ClusterNode{}).Where("id = ?", existing.Id).Updates(updates).Error; err != nil {
		return nil, err
	}
	return GetClusterNodeById(existing.Id)
}

func GetStaleClusterNodes(cutoff int64) ([]*ClusterNode, error) {
	var nodes []*ClusterNode
	err := DB.Where("last_seen_at > ? AND last_seen_at < ? AND status <> ?", 0, cutoff, "offline").Find(&nodes).Error
	return nodes, err
}

func MarkClusterNodeOffline(id int) error {
	return DB.Model(&ClusterNode{}).Where("id = ?", id).Updates(map[string]any{
		"status": "offline",
	}).Error
}

// SyncClusterManagedChannelStatus only toggles automatic state. An operator's
// manually-disabled channel is never re-enabled by a heartbeat.
func SyncClusterManagedChannelStatus(channelId int, available bool, reason string) {
	if channelId <= 0 {
		return
	}
	channel, err := GetChannelById(channelId, true)
	if err != nil {
		return
	}
	if available {
		if channel.Status == common.ChannelStatusAutoDisabled {
			UpdateChannelStatus(channelId, "", common.ChannelStatusEnabled, reason)
		}
		return
	}
	if channel.Status == common.ChannelStatusEnabled {
		UpdateChannelStatus(channelId, "", common.ChannelStatusAutoDisabled, reason)
	}
}

func ClusterNodeOfflineCutoff(timeout time.Duration) int64 {
	return time.Now().Add(-timeout).Unix()
}
