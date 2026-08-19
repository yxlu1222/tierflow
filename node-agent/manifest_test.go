package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestVerifyManifest(t *testing.T) {
	dir := t.TempDir()
	content := []byte("tierflow")
	if err := os.WriteFile(filepath.Join(dir, "weights.bin"), content, 0600); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(content)
	manifest := filepath.Join(dir, "manifest.sha256")
	if err := os.WriteFile(manifest, []byte(fmt.Sprintf("%x  weights.bin\n", sum)), 0600); err != nil {
		t.Fatal(err)
	}
	result, err := verifyManifest(context.Background(), ModelConfig{ID: "test", ModelPath: dir, ManifestPath: manifest})
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || len(result.Files) != 1 || !result.Files[0].OK {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestConfigRejectsUnsafeUnit(t *testing.T) {
	cfg := Config{NodeName: "node", Role: "worker", Listen: ":9020", AdvertiseURL: "http://127.0.0.1:9020", ControllerURL: "http://127.0.0.1/api/cluster/heartbeat", TokenFile: "/tmp/token", Models: []ModelConfig{{ID: "model", Service: "safe.service;reboot"}}}
	if err := cfg.validate(); err == nil {
		t.Fatal("expected unsafe systemd unit to be rejected")
	}
}
