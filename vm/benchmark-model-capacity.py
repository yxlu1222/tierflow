#!/usr/bin/env python3
"""Measure OpenAI-compatible model throughput and host unified-memory use."""

import argparse
import concurrent.futures
import json
import statistics
import threading
import time
import urllib.request


GIB = 1024**3


def read_memory():
    values = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, value = line.split(":", 1)
            values[key] = int(value.strip().split()[0]) * 1024
    total = values["MemTotal"]
    available = values["MemAvailable"]
    return {
        "used_gib": (total - available) / GIB,
        "available_gib": available / GIB,
    }


def stream_request(base_url, model, max_tokens, timeout, request_id):
    prompt = (
        f"Request {request_id}: write a long numbered list of concise, distinct facts "
        "about reliable local AI inference. Continue until the output limit."
    )
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "ignore_eos": True,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/v1/chat/completions",
        json.dumps(body).encode("utf-8"),
        {"Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    first_output = None
    last_output = None
    output_events = 0
    usage = {}
    with urllib.request.urlopen(request, timeout=timeout) as response:
        for raw_line in response:
            line = raw_line.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                break
            chunk = json.loads(payload)
            if chunk.get("usage"):
                usage = chunk["usage"]
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            if delta.get("content") or delta.get("reasoning_content"):
                now = time.perf_counter()
                first_output = first_output or now
                last_output = now
                output_events += 1

    completed = time.perf_counter()
    completion_tokens = int(usage.get("completion_tokens") or output_events)
    decode_seconds = (
        last_output - first_output
        if first_output is not None and last_output is not None
        else 0.0
    )
    decode_tokens = max(0, completion_tokens - 1)
    return {
        "completion_tokens": completion_tokens,
        "prompt_tokens": int(usage.get("prompt_tokens") or 0),
        "ttft_seconds": first_output - started if first_output else None,
        "e2e_seconds": completed - started,
        "decode_tps": decode_tokens / decode_seconds if decode_seconds else 0.0,
    }


def run_batch(args, concurrency, repeat):
    samples = []
    stop_sampling = threading.Event()

    def sample_loop():
        while not stop_sampling.is_set():
            samples.append(read_memory())
            stop_sampling.wait(args.sample_interval)

    baseline = read_memory()
    sampler = threading.Thread(target=sample_loop, daemon=True)
    sampler.start()
    started = time.perf_counter()
    try:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=concurrency
        ) as executor:
            futures = [
                executor.submit(
                    stream_request,
                    args.base_url,
                    args.model,
                    args.max_tokens,
                    args.timeout,
                    f"c{concurrency}-r{repeat}-{index}",
                )
                for index in range(concurrency)
            ]
            results = [future.result() for future in futures]
    finally:
        stop_sampling.set()
        sampler.join(timeout=2)
        samples.append(read_memory())
    elapsed = time.perf_counter() - started

    completion_tokens = sum(row["completion_tokens"] for row in results)
    return {
        "kind": "batch",
        "model": args.model,
        "concurrency": concurrency,
        "repeat": repeat,
        "max_tokens": args.max_tokens,
        "aggregate_e2e_tps": completion_tokens / elapsed,
        "median_request_decode_tps": statistics.median(
            row["decode_tps"] for row in results
        ),
        "median_ttft_seconds": statistics.median(
            row["ttft_seconds"] for row in results if row["ttft_seconds"] is not None
        ),
        "median_e2e_seconds": statistics.median(
            row["e2e_seconds"] for row in results
        ),
        "completion_tokens": completion_tokens,
        "baseline_used_gib": baseline["used_gib"],
        "peak_used_gib": max(row["used_gib"] for row in samples),
        "minimum_available_gib": min(row["available_gib"] for row in samples),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--levels", default="1,2,4")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--max-tokens", type=int, default=256)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--sample-interval", type=float, default=0.2)
    parser.add_argument("--cooldown", type=float, default=1.0)
    args = parser.parse_args()

    print(json.dumps({"kind": "idle_baseline", **read_memory()}), flush=True)
    warmup = stream_request(
        args.base_url, args.model, min(64, args.max_tokens), args.timeout, "warmup"
    )
    print(json.dumps({"kind": "warmup", **warmup}), flush=True)
    time.sleep(args.cooldown)

    rows = []
    for raw_level in args.levels.split(","):
        concurrency = int(raw_level.strip())
        for repeat in range(1, args.repeats + 1):
            row = run_batch(args, concurrency, repeat)
            rows.append(row)
            print(json.dumps(row), flush=True)
            time.sleep(args.cooldown)

    summary = {}
    for concurrency in sorted({row["concurrency"] for row in rows}):
        selected = [row for row in rows if row["concurrency"] == concurrency]
        summary[str(concurrency)] = {
            "median_aggregate_e2e_tps": statistics.median(
                row["aggregate_e2e_tps"] for row in selected
            ),
            "median_request_decode_tps": statistics.median(
                row["median_request_decode_tps"] for row in selected
            ),
            "median_ttft_seconds": statistics.median(
                row["median_ttft_seconds"] for row in selected
            ),
            "maximum_peak_used_gib": max(
                row["peak_used_gib"] for row in selected
            ),
            "minimum_available_gib": min(
                row["minimum_available_gib"] for row in selected
            ),
        }
    print(json.dumps({"kind": "summary", "levels": summary}), flush=True)


if __name__ == "__main__":
    main()
