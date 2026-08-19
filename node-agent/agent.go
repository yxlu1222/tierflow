package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Agent struct {
	config           Config
	token            string
	hostname         string
	client           *http.Client
	stateMu          sync.RWMutex
	state            persistedState
	heartbeatSuccess atomic.Uint64
	heartbeatFailure atomic.Uint64
	actionCount      atomic.Uint64
}

func newAgent(cfg Config, token string) (*Agent, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, err
	}
	agent := &Agent{
		config:   cfg,
		token:    token,
		hostname: hostname,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
	agent.loadState()
	return agent, nil
}

func (a *Agent) modelByID(id string) (ModelConfig, bool) {
	for _, model := range a.config.Models {
		if model.ID == id {
			return model, true
		}
	}
	return ModelConfig{}, false
}

func (a *Agent) authorized(r *http.Request) bool {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return false
	}
	got := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	return len(got) == len(a.token) && subtle.ConstantTimeCompare([]byte(got), []byte(a.token)) == 1
}

func (a *Agent) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !a.authorized(r) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (a *Agent) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", a.handleHealth)
	mux.HandleFunc("GET /v1/status", a.requireAuth(a.handleStatus))
	mux.HandleFunc("GET /v1/models", a.requireAuth(a.handleModels))
	mux.HandleFunc("POST /v1/drain", a.requireAuth(a.handleDrain))
	mux.HandleFunc("POST /v1/models/{id}/actions", a.requireAuth(a.handleModelAction))
	mux.HandleFunc("GET /v1/models/{id}/logs", a.requireAuth(a.handleModelLogs))
	mux.HandleFunc("POST /v1/models/{id}/verify", a.requireAuth(a.handleModelVerify))
	mux.HandleFunc("GET /metrics", a.requireAuth(a.handleMetrics))
	return mux
}

func (a *Agent) collectStatus(ctx context.Context) nodeStatus {
	memory := readMemoryStatus()
	commandCtx, cancel := context.WithTimeout(ctx, a.config.commandTimeout())
	defer cancel()
	models := make([]modelStatus, 0, len(a.config.Models))
	for _, model := range a.config.Models {
		models = append(models, collectModelStatus(commandCtx, model))
	}
	a.stateMu.RLock()
	draining := a.state.Draining
	a.stateMu.RUnlock()
	return nodeStatus{
		NodeName:     a.config.NodeName,
		Hostname:     a.hostname,
		Role:         a.config.Role,
		AgentURL:     a.config.AdvertiseURL,
		AgentVersion: agentVersion,
		Draining:     draining,
		Memory:       memory,
		CUDA:         readCUDAStatus(commandCtx, memory),
		Disk:         readDiskStatus(a.config.DiskPath),
		Models:       models,
		CollectedAt:  time.Now().Unix(),
	}
}

func (a *Agent) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "version": agentVersion})
}

func (a *Agent) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.collectStatus(r.Context()))
}

func (a *Agent) handleModels(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, a.collectStatus(r.Context()).Models)
}

func (a *Agent) handleDrain(w http.ResponseWriter, r *http.Request) {
	var request drainRequest
	if err := decodeJSON(r.Body, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	a.stateMu.Lock()
	a.state.Draining = request.Draining
	err := a.saveStateLocked()
	a.stateMu.Unlock()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"draining": request.Draining})
}

func (a *Agent) handleModelAction(w http.ResponseWriter, r *http.Request) {
	model, ok := a.modelByID(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "model is not in the whitelist"})
		return
	}
	var request actionRequest
	if err := decodeJSON(r.Body, &request); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	request.Action = strings.ToLower(strings.TrimSpace(request.Action))
	a.stateMu.RLock()
	draining := a.state.Draining
	a.stateMu.RUnlock()
	if draining && (request.Action == "start" || request.Action == "restart") {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "node is draining"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), a.config.commandTimeout())
	defer cancel()
	if err := runModelAction(ctx, model.Service, request.Action); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	a.actionCount.Add(1)
	writeJSON(w, http.StatusOK, actionResponse{
		Model: collectModelStatus(ctx, model), Action: request.Action, At: time.Now(),
	})
}

func (a *Agent) handleModelLogs(w http.ResponseWriter, r *http.Request) {
	model, ok := a.modelByID(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "model is not in the whitelist"})
		return
	}
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	ctx, cancel := context.WithTimeout(r.Context(), a.config.commandTimeout())
	defer cancel()
	logs, err := journalLogs(ctx, model.Service, lines)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"model_id": model.ID, "service": model.Service, "logs": logs})
}

func (a *Agent) handleModelVerify(w http.ResponseWriter, r *http.Request) {
	model, ok := a.modelByID(r.PathValue("id"))
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "model is not in the whitelist"})
		return
	}
	result, err := verifyManifest(r.Context(), model)
	if err != nil {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "result": result})
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (a *Agent) handleMetrics(w http.ResponseWriter, r *http.Request) {
	status := a.collectStatus(r.Context())
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(w, "tierflow_node_memory_total_bytes %d\n", status.Memory.TotalBytes)
	fmt.Fprintf(w, "tierflow_node_memory_available_bytes %d\n", status.Memory.AvailableBytes)
	fmt.Fprintf(w, "tierflow_node_disk_available_bytes %d\n", status.Disk.AvailableBytes)
	if status.Draining {
		fmt.Fprintln(w, "tierflow_node_draining 1")
	} else {
		fmt.Fprintln(w, "tierflow_node_draining 0")
	}
	fmt.Fprintf(w, "tierflow_node_heartbeat_success_total %d\n", a.heartbeatSuccess.Load())
	fmt.Fprintf(w, "tierflow_node_heartbeat_failure_total %d\n", a.heartbeatFailure.Load())
	fmt.Fprintf(w, "tierflow_node_model_action_total %d\n", a.actionCount.Load())
	for _, model := range status.Models {
		up := 0
		if model.State == "active" && model.EndpointHealthy {
			up = 1
		}
		fmt.Fprintf(w, "tierflow_node_model_up{model=%q} %d\n", model.ID, up)
		fmt.Fprintf(w, "tierflow_node_model_memory_bytes{model=%q} %d\n", model.ID, model.MemoryBytes)
	}
}

func (a *Agent) sendHeartbeat(ctx context.Context) error {
	status := a.collectStatus(ctx)
	body, err := json.Marshal(status)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, a.config.ControllerURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+a.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := a.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("controller returned %s: %s", response.Status, strings.TrimSpace(string(message)))
	}
	return nil
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(a.config.heartbeatInterval())
	defer ticker.Stop()
	for {
		heartbeatCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		err := a.sendHeartbeat(heartbeatCtx)
		cancel()
		if err != nil {
			a.heartbeatFailure.Add(1)
			log.Printf("heartbeat failed: %v", err)
		} else {
			a.heartbeatSuccess.Add(1)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (a *Agent) loadState() {
	data, err := os.ReadFile(a.config.StateFile)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &a.state)
}

func (a *Agent) saveStateLocked() error {
	data, err := json.Marshal(a.state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepathDir(a.config.StateFile), 0750); err != nil {
		return err
	}
	temporary := a.config.StateFile + ".tmp"
	if err := os.WriteFile(temporary, data, 0640); err != nil {
		return err
	}
	return os.Rename(temporary, a.config.StateFile)
}

func filepathDir(path string) string {
	index := strings.LastIndex(path, string(os.PathSeparator))
	if index <= 0 {
		return "."
	}
	return path[:index]
}

func decodeJSON(reader io.Reader, target any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, 1024*1024))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("write response: %v", err)
	}
}
