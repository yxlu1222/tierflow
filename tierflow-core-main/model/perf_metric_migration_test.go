package model

import "testing"

// TestMigratePerfMetricUniqueIndex reproduces an upgraded database that still
// carries the legacy 3-column unique index (model_name, group, bucket_ts) and
// verifies migratePerfMetricUniqueIndex + AutoMigrate replace it with the
// channel-scoped 4-column index, so UpsertPerfMetric's ON CONFLICT resolves and
// two channels for the same bucket persist as distinct rows instead of erroring
// or merging.
func TestMigratePerfMetricUniqueIndex(t *testing.T) {
	// Simulate the pre-channel_id schema: drop the current table and recreate
	// perf_metrics carrying only the LEGACY 3-column unique index by its old name.
	if err := DB.Migrator().DropTable(&PerfMetric{}); err != nil {
		t.Fatalf("drop table: %v", err)
	}
	if err := DB.Exec(`CREATE TABLE perf_metrics (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		model_name TEXT,
		"group" TEXT,
		channel_id INTEGER DEFAULT 0,
		bucket_ts INTEGER,
		request_count INTEGER DEFAULT 0,
		success_count INTEGER DEFAULT 0,
		total_latency_ms INTEGER DEFAULT 0,
		ttft_sum_ms INTEGER DEFAULT 0,
		ttft_count INTEGER DEFAULT 0,
		output_tokens INTEGER DEFAULT 0,
		generation_ms INTEGER DEFAULT 0
	)`).Error; err != nil {
		t.Fatalf("create legacy table: %v", err)
	}
	if err := DB.Exec(`CREATE UNIQUE INDEX idx_perf_model_group_bucket ON perf_metrics (model_name, "group", bucket_ts)`).Error; err != nil {
		t.Fatalf("create legacy index: %v", err)
	}
	if !DB.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket") {
		t.Fatal("expected legacy index to exist before migration")
	}

	// Run the migration exactly as InitDB would: drop legacy index, then AutoMigrate.
	if err := migratePerfMetricUniqueIndex(); err != nil {
		t.Fatalf("migratePerfMetricUniqueIndex: %v", err)
	}
	if err := DB.AutoMigrate(&PerfMetric{}); err != nil {
		t.Fatalf("automigrate: %v", err)
	}

	if DB.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_bucket") {
		t.Error("legacy 3-column index should have been dropped")
	}
	if !DB.Migrator().HasIndex(&PerfMetric{}, "idx_perf_model_group_channel_bucket") {
		t.Error("new channel-scoped unique index should exist")
	}

	// Idempotency: running again is a no-op (old index already gone).
	if err := migratePerfMetricUniqueIndex(); err != nil {
		t.Fatalf("second migratePerfMetricUniqueIndex should be a no-op: %v", err)
	}

	// With the fixed index, two channels in the same bucket persist distinctly,
	// and a repeat of the same key accumulates onto the existing row.
	if err := UpsertPerfMetric(&PerfMetric{ModelName: "m", Group: "g", ChannelId: 1, BucketTs: 100, RequestCount: 2}); err != nil {
		t.Fatalf("upsert ch1: %v", err)
	}
	if err := UpsertPerfMetric(&PerfMetric{ModelName: "m", Group: "g", ChannelId: 2, BucketTs: 100, RequestCount: 3}); err != nil {
		t.Fatalf("upsert ch2 (would fail/merge with the stale index): %v", err)
	}
	if err := UpsertPerfMetric(&PerfMetric{ModelName: "m", Group: "g", ChannelId: 1, BucketTs: 100, RequestCount: 5}); err != nil {
		t.Fatalf("upsert ch1 again: %v", err)
	}

	var rows []PerfMetric
	if err := DB.Where("model_name = ? AND bucket_ts = ?", "m", int64(100)).Order("channel_id").Find(&rows).Error; err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 distinct channel rows, got %d", len(rows))
	}
	if rows[0].ChannelId != 1 || rows[0].RequestCount != 7 { // 2 + 5 accumulated
		t.Errorf("ch1 row wrong: %+v", rows[0])
	}
	if rows[1].ChannelId != 2 || rows[1].RequestCount != 3 {
		t.Errorf("ch2 row wrong: %+v", rows[1])
	}

	DB.Exec("DELETE FROM perf_metrics")
}
