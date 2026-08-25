#!/usr/bin/env bash
set -euo pipefail

db=/var/lib/tierflow/tierflow.db
base_url=http://127.0.0.1:8104
model=Nemotron-3.5-Lightning-30B-A3B

sqlite3 "$db" <<SQL
.headers on
.mode column
SELECT id, name, status, base_url, models
  FROM channels
 WHERE base_url = '$base_url';
SELECT id, name, status, length(key) AS key_length,
       substr(key, 1, 3) AS key_prefix, expired_time,
       unlimited_quota, remain_quota, user_id
  FROM tokens
 WHERE name = 'test';
SQL

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
python3 -c 'import json,sys; data=json.load(sys.stdin); print(json.dumps({"models":[x.get("id") for x in data.get("data",[])]}, ensure_ascii=False))' < "$response_file"

curl -fsS http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with exactly: TierFlow Nemotron OK\"}],\"temperature\":0,\"max_tokens\":128,\"chat_template_kwargs\":{\"enable_thinking\":false}}" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); print(json.dumps({"model":data.get("model"),"content":data.get("choices",[{}])[0].get("message",{}).get("content"),"usage":data.get("usage")}, ensure_ascii=False))'

curl -fsS http://127.0.0.1:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $auth_token" \
  --data-binary "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"What is the current weather in Beijing? You must call get_weather.\"}],\"tools\":[{\"type\":\"function\",\"function\":{\"name\":\"get_weather\",\"description\":\"Get current weather\",\"parameters\":{\"type\":\"object\",\"properties\":{\"city\":{\"type\":\"string\"}},\"required\":[\"city\"]}}}],\"tool_choice\":\"auto\",\"temperature\":0,\"max_tokens\":256,\"chat_template_kwargs\":{\"enable_thinking\":false}}" \
  | python3 -c 'import json,sys; data=json.load(sys.stdin); msg=data.get("choices",[{}])[0].get("message",{}); print(json.dumps({"finish_reason":data.get("choices",[{}])[0].get("finish_reason"),"tool_calls":msg.get("tool_calls"),"usage":data.get("usage")}, ensure_ascii=False))'
