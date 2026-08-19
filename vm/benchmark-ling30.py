#!/usr/bin/env python3
"""Benchmark Ling-3.0-tiny on DGX Spark via its direct SGLang endpoint.

Measures streamed TTFT, decode/batch throughput, a unique long-context prefill,
CUDA-visible unified-memory use, Linux memory availability, SGLang RSS, and
selected SGLang runtime metrics.
"""

import argparse
import concurrent.futures
import json
import math
import re
import statistics
import subprocess
import threading
import time
import urllib.request
import uuid


GIB = 1024 ** 3
SGLANG_PROCESS_MARKERS = (
    "sglang::scheduler",
    "sglang::detokenizer",
    "sglang.launch_server",
)


def percentile(values, fraction):
    if not values:
        return None
    index = max(0, math.ceil(len(values) * fraction) - 1)
    return sorted(values)[index]


def stream_request(base_url, model, messages, max_tokens, timeout):
    body = {
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": max_tokens,
        "min_tokens": max_tokens,
        "ignore_eos": True,
        "stream": True,
        "stream_options": {"include_usage": True},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    request = urllib.request.Request(
        base_url.rstrip("/") + "/v1/chat/completions",
        json.dumps(body, ensure_ascii=False).encode("utf-8"),
        {"Content-Type": "application/json"},
        method="POST",
    )

    started = time.perf_counter()
    first_output = None
    last_output = None
    usage = {}
    finish_reason = None
    output_events = 0
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
            choice = choices[0]
            if choice.get("finish_reason") is not None:
                finish_reason = choice["finish_reason"]
            delta = choice.get("delta") or {}
            if delta.get("content") or delta.get("reasoning_content") or delta.get("tool_calls"):
                now = time.perf_counter()
                if first_output is None:
                    first_output = now
                last_output = now
                output_events += 1

    completed = time.perf_counter()
    completion_tokens = int(usage.get("completion_tokens") or output_events)
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    decode_seconds = (
        last_output - first_output
        if first_output is not None and last_output is not None
        else 0.0
    )
    decode_tokens = max(0, completion_tokens - 1)
    return {
        "started": started,
        "first_output": first_output,
        "last_output": last_output,
        "completed": completed,
        "ttft_seconds": first_output - started if first_output is not None else None,
        "e2e_seconds": completed - started,
        "decode_seconds": decode_seconds,
        "decode_tps": decode_tokens / decode_seconds if decode_seconds > 0 else None,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "finish_reason": finish_reason,
    }


def read_meminfo():
    values = {}
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            key, value = line.split(":", 1)
            values[key] = int(value.strip().split()[0]) * 1024
    return values


def sample_runtime(base_url):
    sample = {"at": time.perf_counter()}
    meminfo = read_meminfo()
    sample["mem_available_gib"] = meminfo["MemAvailable"] / GIB
    sample["mem_used_gib"] = (meminfo["MemTotal"] - meminfo["MemAvailable"]) / GIB

    try:
        total, free = subprocess.check_output(
            ["/usr/local/bin/tierflow-cuda-memory"],
            text=True,
            timeout=2,
        ).split()
        total = int(total)
        free = int(free)
        sample["cuda_total_gib"] = total / GIB
        sample["cuda_free_gib"] = free / GIB
        sample["cuda_used_gib"] = (total - free) / GIB
    except Exception:
        pass

    try:
        process_rows = subprocess.check_output(
            ["ps", "-eo", "rss=,args="], text=True, timeout=2
        )
        rss_kib = 0
        for line in process_rows.splitlines():
            if any(marker in line for marker in SGLANG_PROCESS_MARKERS):
                rss_kib += int(line.strip().split(None, 1)[0])
        sample["sglang_rss_gib"] = rss_kib * 1024 / GIB
    except Exception:
        pass

    try:
        metrics = urllib.request.urlopen(
            base_url.rstrip("/") + "/metrics", timeout=2
        ).read().decode("utf-8", "replace")
        for key in (
            "num_running_reqs",
            "num_queue_reqs",
            "token_usage",
            "full_token_usage",
        ):
            matches = re.findall(
                r"^sglang:" + key + r"(?:\{[^}]*\})?\s+([-+0-9.eE]+)$",
                metrics,
                re.MULTILINE,
            )
            if matches:
                sample[key] = max(float(value) for value in matches)
    except Exception:
        pass
    return sample


class RuntimeMonitor:
    def __init__(self, base_url, interval):
        self.base_url = base_url
        self.interval = interval
        self.samples = []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop_event.is_set():
            try:
                self.samples.append(sample_runtime(self.base_url))
            except Exception:
                pass
            self.stop_event.wait(self.interval)

    def start(self):
        self.samples.append(sample_runtime(self.base_url))
        self.thread.start()

    def stop(self):
        try:
            self.samples.append(sample_runtime(self.base_url))
        except Exception:
            pass
        self.stop_event.set()
        self.thread.join(timeout=5)

    def summary(self):
        baseline = self.samples[0] if self.samples else {}

        def peak(key):
            values = [row[key] for row in self.samples if key in row]
            return max(values) if values else None

        def low(key):
            values = [row[key] for row in self.samples if key in row]
            return min(values) if values else None

        cuda_peak = peak("cuda_used_gib")
        mem_available_low = low("mem_available_gib")
        rss_peak = peak("sglang_rss_gib")
        return {
            "sample_count": len(self.samples),
            "baseline_cuda_used_gib": baseline.get("cuda_used_gib"),
            "peak_cuda_used_gib": cuda_peak,
            "cuda_used_delta_gib": (
                cuda_peak - baseline["cuda_used_gib"]
                if cuda_peak is not None and "cuda_used_gib" in baseline
                else None
            ),
            "minimum_cuda_free_gib": low("cuda_free_gib"),
            "baseline_mem_available_gib": baseline.get("mem_available_gib"),
            "minimum_mem_available_gib": mem_available_low,
            "mem_available_drop_gib": (
                baseline["mem_available_gib"] - mem_available_low
                if mem_available_low is not None and "mem_available_gib" in baseline
                else None
            ),
            "baseline_sglang_rss_gib": baseline.get("sglang_rss_gib"),
            "peak_sglang_rss_gib": rss_peak,
            "sglang_rss_delta_gib": (
                rss_peak - baseline["sglang_rss_gib"]
                if rss_peak is not None and "sglang_rss_gib" in baseline
                else None
            ),
            "peak_running_requests": peak("num_running_reqs"),
            "peak_queued_requests": peak("num_queue_reqs"),
            "peak_token_usage_percent": (
                peak("token_usage") * 100 if peak("token_usage") is not None else None
            ),
            "peak_full_token_usage_percent": (
                peak("full_token_usage") * 100
                if peak("full_token_usage") is not None
                else None
            ),
        }


def short_prompt(run_id, request_id):
    return (
        "Write a continuous, detailed English technical explanation about reliable local "
        "LLM inference. Do not use tools, headings, tables, or a conclusion, and continue "
        "until the output limit. Discuss batching, KV cache, scheduling, observability, "
        f"and overload handling. Benchmark nonce: {run_id}-{request_id}."
    )


def run_batch(args, concurrency, repeat):
    run_id = uuid.uuid4().hex
    monitor = RuntimeMonitor(args.base_url, args.sample_interval)
    monitor.start()
    batch_started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(
                stream_request,
                args.base_url,
                args.model,
                [{"role": "user", "content": short_prompt(run_id, request_id)}],
                args.max_tokens,
                args.timeout,
            )
            for request_id in range(concurrency)
        ]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]
    batch_completed = time.perf_counter()
    monitor.stop()

    completion_tokens = sum(row["completion_tokens"] for row in results)
    first_outputs = [row["first_output"] for row in results if row["first_output"] is not None]
    last_outputs = [row["last_output"] for row in results if row["last_output"] is not None]
    active_decode_seconds = (
        max(last_outputs) - min(first_outputs)
        if first_outputs and last_outputs
        else 0.0
    )
    ttfts = [row["ttft_seconds"] for row in results if row["ttft_seconds"] is not None]
    e2e = [row["e2e_seconds"] for row in results]
    decode_tps = [row["decode_tps"] for row in results if row["decode_tps"] is not None]
    return {
        "kind": "decode_concurrency",
        "concurrency": concurrency,
        "repeat": repeat,
        "request_count": len(results),
        "prompt_tokens_total": sum(row["prompt_tokens"] for row in results),
        "completion_tokens_total": completion_tokens,
        "batch_seconds": batch_completed - batch_started,
        "aggregate_e2e_tps": completion_tokens / (batch_completed - batch_started),
        "aggregate_active_decode_tps": (
            max(0, completion_tokens - len(results)) / active_decode_seconds
            if active_decode_seconds > 0
            else None
        ),
        "median_request_decode_tps": statistics.median(decode_tps) if decode_tps else None,
        "median_ttft_seconds": statistics.median(ttfts) if ttfts else None,
        "p95_ttft_seconds": percentile(ttfts, 0.95),
        "median_e2e_seconds": statistics.median(e2e),
        "p95_e2e_seconds": percentile(e2e, 0.95),
        "memory": monitor.summary(),
        "requests": [
            {key: value for key, value in row.items() if key not in {"started", "first_output", "last_output", "completed"}}
            for row in results
        ],
    }


def make_long_context(records, nonce):
    sections = []
    for index in range(records):
        sections.append(
            f"Record {index:05d} nonce {nonce}: A local inference gateway observed request "
            f"batch {index % 17}, queue depth {index % 9}, cache pressure {index % 13}, and "
            f"latency marker {(index * 7919) % 104729}. Preserve this evidence and distinguish "
            "measured facts from hypotheses during the final synthesis."
        )
    sections.append(
        "Using all records above, write a concise operational synthesis. Do not quote records "
        "verbatim and do not use tools."
    )
    return [{"role": "user", "content": "\n".join(sections)}]


def run_long_context(args):
    initial_records = max(1, args.long_context_tokens // 55)
    calibration = stream_request(
        args.base_url,
        args.model,
        make_long_context(initial_records, uuid.uuid4().hex),
        1,
        args.timeout,
    )
    calibration_tokens = calibration["prompt_tokens"]
    if calibration_tokens <= 0:
        raise RuntimeError("Long-context calibration did not return prompt token usage")
    records = max(
        1,
        round(initial_records * args.long_context_tokens / calibration_tokens),
    )
    messages = make_long_context(records, uuid.uuid4().hex)
    monitor = RuntimeMonitor(args.base_url, args.sample_interval)
    monitor.start()
    result = stream_request(
        args.base_url,
        args.model,
        messages,
        args.long_output_tokens,
        args.timeout,
    )
    monitor.stop()
    ttft = result["ttft_seconds"]
    return {
        "kind": "long_context_prefill",
        "target_prompt_tokens": args.long_context_tokens,
        "calibration_prompt_tokens": calibration_tokens,
        "calibration_record_count": initial_records,
        "calibration_ttft_seconds": calibration["ttft_seconds"],
        "record_count": records,
        "reported_prompt_tokens": result["prompt_tokens"],
        "completion_tokens": result["completion_tokens"],
        "ttft_seconds": ttft,
        "estimated_prefill_tps": result["prompt_tokens"] / ttft if ttft else None,
        "decode_tps": result["decode_tps"],
        "e2e_seconds": result["e2e_seconds"],
        "finish_reason": result["finish_reason"],
        "memory": monitor.summary(),
    }


def summarize(rows):
    output = {}
    levels = sorted({row["concurrency"] for row in rows if row["kind"] == "decode_concurrency"})
    for level in levels:
        selected = [
            row for row in rows
            if row["kind"] == "decode_concurrency" and row["concurrency"] == level
        ]
        output[str(level)] = {
            "median_aggregate_e2e_tps": statistics.median(row["aggregate_e2e_tps"] for row in selected),
            "median_aggregate_active_decode_tps": statistics.median(row["aggregate_active_decode_tps"] for row in selected),
            "median_request_decode_tps": statistics.median(row["median_request_decode_tps"] for row in selected),
            "median_ttft_seconds": statistics.median(row["median_ttft_seconds"] for row in selected),
            "median_e2e_seconds": statistics.median(row["median_e2e_seconds"] for row in selected),
            "maximum_peak_cuda_used_gib": max(row["memory"]["peak_cuda_used_gib"] for row in selected),
            "maximum_cuda_used_delta_gib": max(row["memory"]["cuda_used_delta_gib"] for row in selected),
            "minimum_mem_available_gib": min(row["memory"]["minimum_mem_available_gib"] for row in selected),
            "maximum_peak_sglang_rss_gib": max(row["memory"]["peak_sglang_rss_gib"] for row in selected),
        }
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8106")
    parser.add_argument("--model", default="Ling-3.0-tiny")
    parser.add_argument("--levels", default="1,2,4,8")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--max-tokens", type=int, default=512)
    parser.add_argument("--long-context-tokens", type=int, default=32768)
    parser.add_argument("--long-output-tokens", type=int, default=64)
    parser.add_argument("--sample-interval", type=float, default=0.25)
    parser.add_argument("--timeout", type=int, default=1800)
    parser.add_argument("--cooldown", type=float, default=2.0)
    parser.add_argument("--skip-long-context", action="store_true")
    parser.add_argument("--only-long-context", action="store_true")
    args = parser.parse_args()

    baseline = sample_runtime(args.base_url)
    print(json.dumps({"kind": "idle_baseline", **baseline}), flush=True)

    warmup = stream_request(
        args.base_url,
        args.model,
        [{"role": "user", "content": "Explain local inference reliability continuously."}],
        128,
        args.timeout,
    )
    print(
        json.dumps(
            {
                "kind": "warmup",
                **{key: value for key, value in warmup.items() if key not in {"started", "first_output", "last_output", "completed"}},
            }
        ),
        flush=True,
    )
    time.sleep(args.cooldown)

    rows = []
    if not args.only_long_context:
        for raw_level in args.levels.split(","):
            concurrency = int(raw_level.strip())
            for repeat in range(1, args.repeats + 1):
                row = run_batch(args, concurrency, repeat)
                rows.append(row)
                print(json.dumps(row), flush=True)
                time.sleep(args.cooldown)

    if not args.skip_long_context:
        long_row = run_long_context(args)
        rows.append(long_row)
        print(json.dumps(long_row), flush=True)

    print(json.dumps({"kind": "summary", "decode": summarize(rows)}), flush=True)


if __name__ == "__main__":
    main()
