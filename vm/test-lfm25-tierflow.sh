#!/usr/bin/env bash
set -euo pipefail

db=/var/lib/tierflow/tierflow.db
direct_url=http://127.0.0.1:8105
tierflow_url=http://127.0.0.1:3000
model=LFM2.5-2.6B

curl -fsS "$direct_url/v1/models" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({"direct_models":[x.get("id") for x in d.get("data",[])]})'

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
    http_code=$(curl -sS -o "$response_file" -w '%{http_code}' "$tierflow_url/v1/models" \
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
  exit 1
fi

curl -fsS "$tierflow_url/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: LFM OK\"}],\"temperature\":0.1,\"top_k\":50,\"repeat_penalty\":1.1,\"max_tokens\":2048}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); m=d.get("choices",[{}])[0].get("message",{}); print({"model":d.get("model"),"content":m.get("content"),"reasoning":m.get("reasoning_content"),"usage":d.get("usage")})'

curl -fsS "$tierflow_url/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"What is the current weather in Beijing? You must call get_weather.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get current weather\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}],\"tool_choice\":\"auto\",\"temperature\":0.1,\"top_k\":50,\"repeat_penalty\":1.1,\"max_tokens\":256}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("choices",[{}])[0]; m=c.get("message",{}); print({"finish_reason":c.get("finish_reason"),"tool_calls":m.get("tool_calls"),"content":m.get("content"),"usage":d.get("usage")})'
