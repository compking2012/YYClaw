#!/usr/bin/env bash
# Write a changelist between the previous CI commit and HEAD.
#
# Usage:
#   scripts/ci-write-changelist.sh <previous_sha_or_empty> <output_file>
#
# Output is plain text suitable for email / Feishu.
set -euo pipefail

PREV="${1:-}"
OUT="${2:-ci_changelist.txt}"
CURR="$(git rev-parse HEAD)"
CURR_SHORT="$(git rev-parse --short HEAD)"
CURR_SUBJECT="$(git log -1 --pretty=format:'%s' HEAD)"

{
  echo "当前提交：${CURR_SHORT} ${CURR_SUBJECT}"
  echo "当前 SHA：${CURR}"
  if [[ -n "$PREV" ]]; then
    echo "上次 SHA：${PREV}"
  else
    echo "上次 SHA：（无记录）"
  fi
  echo ""
  echo "Changelist:"

  if [[ -z "$PREV" ]]; then
    echo "（首次记录或无法读取上次成功构建的 SHA，列出最近 30 条提交）"
    git --no-pager log -30 --pretty=format:'- %h %ad %an: %s' --date=short
    echo ""
  elif ! git cat-file -e "${PREV}^{commit}" 2>/dev/null; then
    echo "（上次 SHA 在本地仓库不可用，可能因浅克隆；列出最近 30 条提交）"
    git --no-pager log -30 --pretty=format:'- %h %ad %an: %s' --date=short
    echo ""
  elif [[ "$PREV" == "$CURR" ]]; then
    echo "（无新提交，与上次成功构建相同）"
  else
    COUNT="$(git rev-list --count "${PREV}..${CURR}" 2>/dev/null || echo 0)"
    echo "（共 ${COUNT} 条：${PREV:0:8}..${CURR_SHORT}）"
    git --no-pager log --pretty=format:'- %h %ad %an: %s' --date=short "${PREV}..${CURR}"
    echo ""
  fi
} >"$OUT"

echo "[ci-write-changelist] wrote ${OUT} (prev=${PREV:-none} curr=${CURR_SHORT})"
