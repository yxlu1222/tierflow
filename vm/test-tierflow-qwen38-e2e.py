#!/usr/bin/env python3
"""End-to-end appliance API checks through Tierflow's OpenAI-compatible gateway.

Run as root on the appliance so the script can read the local SQLite database.
Secrets are never printed. A temporary common user/token is created for the
negative-quota check and removed in a finally block.
"""

from __future__ import annotations

import json
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


BASE_URL = "http://127.0.0.1:3000"
DB_PATH = "/var/lib/tierflow/tierflow.db"
MODEL = "Qwen3.8-27B"
TIMEOUT = 300


@dataclass
class ApiResult:
    status: int
    body: Any
    elapsed: float


def compact_error(body: Any) -> str:
    if isinstance(body, dict):
        error = body.get("error", body)
        if isinstance(error, dict):
            value = error.get("message") or error.get("code") or error
        else:
            value = error
    else:
        value = body
    text = str(value).replace("\n", " ")
    return text[:300]


def api_request(
    path: str,
    key: str,
    payload: dict[str, Any] | None = None,
    method: str | None = None,
    timeout: int = TIMEOUT,
) -> ApiResult:
    headers = {"Authorization": f"Bearer sk-{key}"}
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers=headers,
        method=method or ("POST" if data is not None else "GET"),
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = raw
            return ApiResult(response.status, body, time.perf_counter() - started)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = raw
        return ApiResult(exc.code, body, time.perf_counter() - started)
    except Exception as exc:  # network failures must be part of the report
        return ApiResult(0, {"error": str(exc)}, time.perf_counter() - started)


def print_result(name: str, result: ApiResult, extra: dict[str, Any] | None = None) -> bool:
    passed = 200 <= result.status < 300
    record: dict[str, Any] = {
        "test": name,
        "ok": passed,
        "status": result.status,
        "elapsed_seconds": round(result.elapsed, 3),
    }
    if extra:
        record.update(extra)
    if not passed:
        record["error"] = compact_error(result.body)
    print(json.dumps(record, ensure_ascii=False), flush=True)
    return passed


def stream_chat(key: str) -> tuple[bool, dict[str, Any]]:
    payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "user",
                "content": "用两句话说明推理一体机的用途，第二句以 TIERFLOW_STREAM_OK 结尾。",
            }
        ],
        "temperature": 0,
        "max_tokens": 160,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    request = urllib.request.Request(
        BASE_URL + "/v1/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer sk-{key}",
            "Content-Type": "application/json",
        },
    )
    started = time.perf_counter()
    first_token_at = None
    chunks = 0
    usage: dict[str, Any] = {}
    finished = False
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            status = response.status
            for raw_line in response:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line == "data: [DONE]":
                    finished = True
                    continue
                if not line.startswith("data: "):
                    continue
                event = json.loads(line[6:])
                if event.get("usage"):
                    usage = event["usage"]
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if delta.get("content") or delta.get("reasoning_content"):
                    if first_token_at is None:
                        first_token_at = time.perf_counter()
                    chunks += 1
        elapsed = time.perf_counter() - started
        completion_tokens = int(usage.get("completion_tokens") or 0)
        extra = {
            "chunks": chunks,
            "done_event": finished,
            "completion_tokens": completion_tokens,
            "ttft_seconds": round(first_token_at - started, 3) if first_token_at else None,
            "e2e_output_tps": round(completion_tokens / elapsed, 2) if elapsed and completion_tokens else None,
        }
        result = ApiResult(status, {}, elapsed)
        ok = print_result("chat_stream", result, extra) and chunks > 0 and finished
        return ok, extra
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        result = ApiResult(exc.code, raw, time.perf_counter() - started)
        return print_result("chat_stream", result), {}
    except Exception as exc:
        result = ApiResult(0, {"error": str(exc)}, time.perf_counter() - started)
        return print_result("chat_stream", result), {}


def extract_chat_message(result: ApiResult) -> dict[str, Any] | None:
    if not isinstance(result.body, dict):
        return None
    choices = result.body.get("choices") or []
    if not choices:
        return None
    message = choices[0].get("message")
    return message if isinstance(message, dict) else None


def create_temp_common_user(conn: sqlite3.Connection) -> tuple[int, str]:
    suffix = secrets.token_hex(6)
    username = f"appliance-e2e-{suffix}"
    uid = ("e2e" + suffix + "000000000000")[:12]
    key = secrets.token_urlsafe(32).replace("-", "").replace("_", "")[:40]
    now = int(time.time())
    cursor = conn.execute(
        """
        INSERT INTO users
          (uid, username, password, display_name, role, status, quota,
           used_quota, request_count, `group`, created_at, last_login_at)
        VALUES (?, ?, ?, ?, 1, 1, -1000000, 1000000, 0, 'default', ?, 0)
        """,
        (uid, username, "test-only-no-login", "Appliance E2E", now),
    )
    user_id = int(cursor.lastrowid)
    conn.execute(
        """
        INSERT INTO tokens
          (user_id, key, status, name, created_time, accessed_time,
           expired_time, remain_quota, unlimited_quota, model_limits_enabled,
           model_limits, allow_ips, used_quota, `group`, cross_group_retry,
           user_subscription_id)
        VALUES (?, ?, 1, ?, ?, 0, -1, -1000000, 0, 0, '', '', 1000000,
                'default', 0, 0)
        """,
        (user_id, key, f"e2e-negative-{suffix}", now),
    )
    conn.commit()
    return user_id, key


def cleanup_temp_common_user(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("DELETE FROM tokens WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()


def main() -> int:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    token_row = conn.execute(
        "SELECT key FROM tokens WHERE name = 'test' AND status = 1 "
        "AND deleted_at IS NULL ORDER BY id LIMIT 1"
    ).fetchone()
    if token_row is None:
        print(json.dumps({"fatal": "active test token not found"}), flush=True)
        return 2
    key = str(token_row["key"])

    outcomes: list[bool] = []

    models = api_request("/v1/models", key)
    model_ids = []
    if isinstance(models.body, dict):
        model_ids = [item.get("id") for item in models.body.get("data", []) if isinstance(item, dict)]
    outcomes.append(print_result("models", models, {"contains_qwen38": MODEL in model_ids}))

    plain = api_request(
        "/v1/chat/completions",
        key,
        {
            "model": MODEL,
            "messages": [
                {"role": "user", "content": "只回复 TIERFLOW_CHAT_OK，不要添加其他内容。"}
            ],
            "temperature": 0,
            "max_tokens": 64,
        },
    )
    plain_message = extract_chat_message(plain) or {}
    usage = plain.body.get("usage", {}) if isinstance(plain.body, dict) else {}
    outcomes.append(
        print_result(
            "chat_non_stream",
            plain,
            {
                "has_content": bool(plain_message.get("content")),
                "completion_tokens": usage.get("completion_tokens"),
            },
        )
    )

    stream_ok, _ = stream_chat(key)
    outcomes.append(stream_ok)

    tools = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "查询指定城市当前天气",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                    "additionalProperties": False,
                },
            },
        }
    ]
    tool_prompt = "北京现在天气怎么样？必须调用 get_weather 工具获取结果。"
    tool_first = api_request(
        "/v1/chat/completions",
        key,
        {
            "model": MODEL,
            "messages": [{"role": "user", "content": tool_prompt}],
            "tools": tools,
            "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
            "temperature": 0,
            "max_tokens": 192,
        },
    )
    assistant_message = extract_chat_message(tool_first) or {}
    tool_calls = assistant_message.get("tool_calls") or []
    tool_call_ok = print_result(
        "chat_tool_call",
        tool_first,
        {
            "tool_call_count": len(tool_calls),
            "tool_name": (
                tool_calls[0].get("function", {}).get("name")
                if tool_calls and isinstance(tool_calls[0], dict)
                else None
            ),
        },
    ) and bool(tool_calls)
    outcomes.append(tool_call_ok)

    if tool_calls:
        call_id = tool_calls[0].get("id")
        second_messages = [
            {"role": "user", "content": tool_prompt},
            assistant_message,
            {
                "role": "tool",
                "tool_call_id": call_id,
                "content": json.dumps(
                    {"city": "北京", "temperature_c": 26, "condition": "晴"},
                    ensure_ascii=False,
                ),
            },
        ]
        tool_second = api_request(
            "/v1/chat/completions",
            key,
            {
                "model": MODEL,
                "messages": second_messages,
                "tools": tools,
                "temperature": 0,
                "max_tokens": 192,
            },
        )
        second_message = extract_chat_message(tool_second) or {}
        outcomes.append(
            print_result(
                "chat_tool_result_roundtrip",
                tool_second,
                {"has_final_content": bool(second_message.get("content"))},
            )
            and bool(second_message.get("content"))
        )
    else:
        outcomes.append(False)
        print(json.dumps({"test": "chat_tool_result_roundtrip", "ok": False, "skipped": True}), flush=True)

    responses = api_request(
        "/v1/responses",
        key,
        {
            "model": MODEL,
            "input": "只回复 TIERFLOW_RESPONSES_OK，不要添加其他内容。",
            "temperature": 0,
            # Qwen3.8 may spend the first ~100 tokens in reasoning. Leave enough
            # budget for the final answer so an empty output is not a false alarm.
            "max_output_tokens": 512,
        },
    )
    output_items = responses.body.get("output", []) if isinstance(responses.body, dict) else []
    outcomes.append(
        print_result(
            "responses_non_stream",
            responses,
            {
                "output_item_count": len(output_items),
                "response_status": responses.body.get("status") if isinstance(responses.body, dict) else None,
                "incomplete_details": responses.body.get("incomplete_details") if isinstance(responses.body, dict) else None,
            },
        )
        and bool(output_items)
    )

    responses_tool = api_request(
        "/v1/responses",
        key,
        {
            "model": MODEL,
            "input": "北京现在天气怎么样？必须调用 get_weather 工具。",
            "tools": [
                {
                    "type": "function",
                    "name": "get_weather",
                    "description": "查询指定城市当前天气",
                    "parameters": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                        "additionalProperties": False,
                    },
                }
            ],
            "tool_choice": {"type": "function", "name": "get_weather"},
            "temperature": 0,
            "max_output_tokens": 192,
        },
    )
    response_tool_items = responses_tool.body.get("output", []) if isinstance(responses_tool.body, dict) else []
    response_function_calls = [
        item for item in response_tool_items
        if isinstance(item, dict) and item.get("type") == "function_call"
    ]
    outcomes.append(
        print_result(
            "responses_tool_call",
            responses_tool,
            {"function_call_count": len(response_function_calls)},
        )
        and bool(response_function_calls)
    )

    temp_user_id = 0
    try:
        temp_user_id, temp_key = create_temp_common_user(conn)
        negative = api_request(
            "/v1/chat/completions",
            temp_key,
            {
                "model": MODEL,
                "messages": [
                    {"role": "user", "content": "只回复 NEGATIVE_QUOTA_OK。"}
                ],
                "temperature": 0,
                "max_tokens": 64,
            },
        )
        negative_message = extract_chat_message(negative) or {}
        outcomes.append(
            print_result(
                "common_user_negative_quota",
                negative,
                {"has_content": bool(negative_message.get("content"))},
            )
            and bool(negative_message.get("content"))
        )
    finally:
        if temp_user_id:
            cleanup_temp_common_user(conn, temp_user_id)
        conn.close()

    passed = sum(1 for item in outcomes if item)
    print(
        json.dumps(
            {"summary": {"passed": passed, "total": len(outcomes), "all_passed": all(outcomes)}},
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if all(outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
