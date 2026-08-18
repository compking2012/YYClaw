#!/usr/bin/env bash
# Continue a workflow task via Host API (requires pnpm dev / YYClaw running).
# 仅调用 /api/office/*，不修改 YYClaw 全局配置（见 tests/unit/office-test-policy.mts）。
set -euo pipefail
TASK_ID="${1:-task-1779442564630-de77bj}"
TOKEN_FILE="${HOME}/.openclaw/office/.host-api-token.dev"
PORT="${CLAWX_PORT_CLAWX_HOST_API:-13210}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "Missing $TOKEN_FILE — restart pnpm dev once after pulling latest server.ts" >&2
  exit 1
fi
TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"

echo "POST /office/tasks/${TASK_ID}/run mode=continue"
curl -sS -X POST "http://127.0.0.1:${PORT}/api/office/tasks/${TASK_ID}/run" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"mode":"continue"}' | python3 -m json.tool
