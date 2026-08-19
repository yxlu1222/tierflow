package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func verifyManifest(ctx context.Context, cfg ModelConfig) (manifestResult, error) {
	result := manifestResult{ModelID: cfg.ID, Manifest: cfg.ManifestPath, OK: true, CheckedAt: time.Now().Unix()}
	if cfg.ManifestPath == "" || cfg.ModelPath == "" {
		return result, fmt.Errorf("model %s has no model_path or manifest_path", cfg.ID)
	}
	f, err := os.Open(cfg.ManifestPath)
	if err != nil {
		return result, fmt.Errorf("open manifest: %w", err)
	}
	defer f.Close()
	root, err := filepath.Abs(cfg.ModelPath)
	if err != nil {
		return result, err
	}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if len(line) < sha256.Size*2+2 {
			return result, fmt.Errorf("invalid manifest line %q", line)
		}
		expected := strings.ToLower(line[:sha256.Size*2])
		if _, err := hex.DecodeString(expected); err != nil {
			return result, fmt.Errorf("invalid checksum in line %q", line)
		}
		rel := strings.TrimSpace(line[sha256.Size*2:])
		rel = strings.TrimPrefix(rel, "*")
		if rel == "" {
			return result, fmt.Errorf("manifest line has no path: %q", line)
		}
		candidate := filepath.Clean(filepath.Join(root, filepath.FromSlash(rel)))
		relative, err := filepath.Rel(root, candidate)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return result, fmt.Errorf("manifest path escapes model root: %q", rel)
		}
		fileResult := manifestFileResult{Path: rel, Expected: expected}
		actual, hashErr := sha256File(ctx, candidate)
		if hashErr != nil {
			fileResult.Error = hashErr.Error()
			result.OK = false
		} else {
			fileResult.Actual = actual
			fileResult.OK = actual == expected
			if !fileResult.OK {
				result.OK = false
			}
		}
		result.Files = append(result.Files, fileResult)
	}
	if err := scanner.Err(); err != nil {
		return result, err
	}
	if len(result.Files) == 0 {
		return result, fmt.Errorf("manifest contains no files")
	}
	return result, nil
}

func sha256File(ctx context.Context, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	hash := sha256.New()
	buffer := make([]byte, 4*1024*1024)
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		n, readErr := f.Read(buffer)
		if n > 0 {
			if _, err := hash.Write(buffer[:n]); err != nil {
				return "", err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
