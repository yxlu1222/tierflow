package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
)

var (
	modelIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	unitPattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.@-]{0,191}\.service$`)
)

type Config struct {
	NodeName                 string        `json:"node_name"`
	Role                     string        `json:"role"`
	Listen                   string        `json:"listen"`
	AdvertiseURL             string        `json:"advertise_url"`
	ControllerURL            string        `json:"controller_url"`
	TokenFile                string        `json:"token_file"`
	StateFile                string        `json:"state_file"`
	DiskPath                 string        `json:"disk_path"`
	HeartbeatIntervalSeconds int           `json:"heartbeat_interval_seconds"`
	CommandTimeoutSeconds    int           `json:"command_timeout_seconds"`
	Models                   []ModelConfig `json:"models"`
}

type ModelConfig struct {
	ID           string `json:"id"`
	DisplayName  string `json:"display_name"`
	Service      string `json:"service"`
	Endpoint     string `json:"endpoint"`
	ModelPath    string `json:"model_path"`
	ManifestPath string `json:"manifest_path"`
	ChannelID    int    `json:"channel_id"`
}

func loadConfig(path string) (Config, string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, "", fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, "", fmt.Errorf("decode config: %w", err)
	}
	if err := cfg.validate(); err != nil {
		return Config{}, "", err
	}
	tokenBytes, err := os.ReadFile(cfg.TokenFile)
	if err != nil {
		return Config{}, "", fmt.Errorf("read token file: %w", err)
	}
	token := strings.TrimSpace(string(tokenBytes))
	if len(token) < 24 {
		return Config{}, "", errors.New("agent token must contain at least 24 characters")
	}
	return cfg, token, nil
}

func (c *Config) validate() error {
	c.NodeName = strings.TrimSpace(c.NodeName)
	if c.NodeName == "" {
		return errors.New("node_name is required")
	}
	if c.Role != "controller" && c.Role != "worker" {
		return errors.New("role must be controller or worker")
	}
	if strings.TrimSpace(c.Listen) == "" {
		c.Listen = "127.0.0.1:9020"
	}
	c.AdvertiseURL = strings.TrimRight(strings.TrimSpace(c.AdvertiseURL), "/")
	if c.AdvertiseURL == "" {
		return errors.New("advertise_url is required")
	}
	if strings.TrimSpace(c.ControllerURL) == "" {
		return errors.New("controller_url is required")
	}
	if strings.TrimSpace(c.TokenFile) == "" {
		return errors.New("token_file is required")
	}
	if strings.TrimSpace(c.StateFile) == "" {
		c.StateFile = "/var/lib/tierflow/node-agent-state.json"
	}
	if strings.TrimSpace(c.DiskPath) == "" {
		c.DiskPath = "/var/lib/tierflow"
	}
	if c.HeartbeatIntervalSeconds <= 0 {
		c.HeartbeatIntervalSeconds = 10
	}
	if c.CommandTimeoutSeconds <= 0 {
		c.CommandTimeoutSeconds = 30
	}
	seen := make(map[string]struct{}, len(c.Models))
	for i := range c.Models {
		m := &c.Models[i]
		m.ID = strings.TrimSpace(m.ID)
		m.Service = strings.TrimSpace(m.Service)
		if !modelIDPattern.MatchString(m.ID) {
			return fmt.Errorf("invalid model id %q", m.ID)
		}
		if !unitPattern.MatchString(m.Service) {
			return fmt.Errorf("invalid systemd service %q for model %s", m.Service, m.ID)
		}
		if _, ok := seen[m.ID]; ok {
			return fmt.Errorf("duplicate model id %q", m.ID)
		}
		seen[m.ID] = struct{}{}
		if strings.TrimSpace(m.DisplayName) == "" {
			m.DisplayName = m.ID
		}
		m.Endpoint = strings.TrimRight(strings.TrimSpace(m.Endpoint), "/")
	}
	return nil
}

func (c Config) heartbeatInterval() time.Duration {
	return time.Duration(c.HeartbeatIntervalSeconds) * time.Second
}

func (c Config) commandTimeout() time.Duration {
	return time.Duration(c.CommandTimeoutSeconds) * time.Second
}
