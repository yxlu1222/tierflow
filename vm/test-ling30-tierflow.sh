#!/usr/bin/env bash
set -euo pipefail

db=/var/lib/tierflow/tierflow.db
model=Ling-3.0-tiny

token_rows=$(sqlite3 -separator '|' "$db" "SELECT id, key FROM tokens WHERE name = 'test' AND status = 1 ORDER BY id;")
if [[ -z "$token_rows" ]]; then
  echo "Active test API key was not found" >&2
  exit 1
fi

response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT
auth_token=''
while IFS='|' read -r token_id token; do
  for mode in raw prefixed; do
    candidate=$token
    if [[ $mode == prefixed && $candidate != sk-* ]]; then
      candidate="sk-$candidate"
    fi
    http_code=$(curl -sS -o "$response_file" -w '%{http_code}' http://127.0.0.1:3000/v1/models \
      -H "Authorization: Bearer $candidate")
    echo "token_id=$token_id mode=$mode models_http_code=$http_code"
    if [[ $http_code == 200 ]]; then
      auth_token=$candidate
      break 2
    fi
  done
done <<< "$token_rows"
if [[ -z $auth_token ]]; then
  cat "$response_file"
  echo
  exit 1
fi

curl -fsS http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: TierFlow Ling OK\"}],\"temperature\":0,\"max_tokens\":128}" \
  >"$response_file"
python3 - "$response_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response:
    data = json.load(response)
message = data.get("choices", [{}])[0].get("message", {})
content = (message.get("content") or "").strip()
if content != "TierFlow Ling OK":
    raise SystemExit(
        "unexpected Ling response: "
        + json.dumps(message, ensure_ascii=False)
    )
print(
    json.dumps(
        {
            "model": data.get("model"),
            "content": content,
            "reasoning_content": message.get("reasoning_content"),
            "usage": data.get("usage"),
        },
        ensure_ascii=False,
    )
)
PY

curl -fsS http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"What is the current weather in Beijing? You must call get_weather.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get current weather\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}],\"tool_choice\":\"auto\",\"temperature\":0,\"max_tokens\":256}" \
  >"$response_file"
python3 - "$response_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as response:
    data = json.load(response)
choice = data.get("choices", [{}])[0]
message = choice.get("message", {})
tool_calls = message.get("tool_calls") or []
if choice.get("finish_reason") != "tool_calls" or not tool_calls:
    raise SystemExit(
        "Ling did not produce a tool call: "
        + json.dumps(choice, ensure_ascii=False)
    )
function = tool_calls[0].get("function", {})
if function.get("name") != "get_weather":
    raise SystemExit(
        "unexpected tool call: " + json.dumps(tool_calls[0], ensure_ascii=False)
    )
arguments = json.loads(function.get("arguments") or "{}")
if arguments.get("city") not in {"Beijing", "北京"}:
    raise SystemExit(
        "unexpected tool arguments: " + json.dumps(arguments, ensure_ascii=False)
    )
print(
    json.dumps(
        {
            "finish_reason": choice.get("finish_reason"),
            "tool_calls": tool_calls,
            "reasoning_content": message.get("reasoning_content"),
            "usage": data.get("usage"),
        },
        ensure_ascii=False,
    )
)
PY
