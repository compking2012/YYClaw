#!/usr/bin/env bash
# CI smoke test for packaged mac-arm64 DMG (silent install + keep running):
# 1. Remove existing YYClaw app + config/data
# 2. Install release DMG to /Applications (detach dmg after copy)
# 3. Launch app (no setup GUI), wait, probe Gateway WS connect.challenge
# 4. Extended e2e: configure domestic GLM-5.2 provider, gateway reload, chat date validation
# 5. On success: leave the new build installed and running (no quit/teardown)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/scripts/ci-smoke.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/scripts/ci-smoke.env"
  set +a
fi

APP_NAME="YYClaw"
APP_PATH="/Applications/${APP_NAME}.app"
GATEWAY_PORT="${SMOKE_GATEWAY_PORT:-18789}"
# Max time budget; poll until gateway is ready instead of a fixed sleep.
GATEWAY_MAX_WAIT_SEC="${SMOKE_GATEWAY_MAX_WAIT_SEC:-${SMOKE_GATEWAY_WAIT_SEC:-45}}"
GATEWAY_POLL_INTERVAL_SEC="${SMOKE_GATEWAY_POLL_INTERVAL_SEC:-3}"
GATEWAY_PROBE_TIMEOUT_MS="${SMOKE_GATEWAY_PROBE_TIMEOUT_MS:-2000}"
MOUNT_POINT=""

log() {
  printf '[mac-arm64-smoke %s] %s\n' "$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %z')" "$*"
}

require_mac_arm64() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    log "ERROR: smoke test must run on macOS (got $(uname -s))"
    exit 1
  fi
  if [[ "$(uname -m)" != "arm64" ]]; then
    log "ERROR: smoke test requires arm64 Mac (got $(uname -m))"
    exit 1
  fi
  log "host: $(sw_vers -productName) $(sw_vers -productVersion) $(uname -m)"
}

quit_app() {
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    log "quitting running ${APP_NAME}..."
    osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
    for _ in $(seq 1 15); do
      if ! pgrep -x "$APP_NAME" >/dev/null 2>&1; then
        break
      fi
      sleep 1
    done
  fi
  if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
    log "force killing ${APP_NAME}..."
    pkill -x "$APP_NAME" >/dev/null 2>&1 || true
    sleep 2
  fi
}

detach_dmg() {
  if [[ -n "${MOUNT_POINT:-}" && -d "$MOUNT_POINT" ]]; then
    log "detaching dmg mount: ${MOUNT_POINT}"
    hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 \
      || hdiutil detach "$MOUNT_POINT" -force -quiet >/dev/null 2>&1 \
      || true
    MOUNT_POINT=""
  fi
}

cleanup_installation() {
  quit_app

  log "removing app bundle: ${APP_PATH}"
  rm -rf "$APP_PATH"

  local app_support="${HOME}/Library/Application Support/${APP_NAME}"
  log "removing app support data: ${app_support}"
  rm -rf "$app_support"

  local openclaw_dir="${HOME}/.openclaw"
  log "removing OpenClaw config/data: ${openclaw_dir}"
  rm -rf "$openclaw_dir"

  local openclaw_cli="${HOME}/.local/bin/openclaw"
  if [[ -e "$openclaw_cli" ]]; then
    log "removing OpenClaw CLI symlink: ${openclaw_cli}"
    rm -f "$openclaw_cli"
  fi

  local launch_agent="${HOME}/Library/LaunchAgents/ai.openclaw.gateway.plist"
  if [[ -f "$launch_agent" ]]; then
    log "removing legacy gateway launch agent: ${launch_agent}"
    rm -f "$launch_agent"
  fi

  log "cleanup finished"
}

resolve_dmg() {
  if [[ -n "${SMOKE_DMG_PATH:-}" ]]; then
    if [[ ! -f "$SMOKE_DMG_PATH" ]]; then
      log "ERROR: SMOKE_DMG_PATH not found: ${SMOKE_DMG_PATH}"
      exit 1
    fi
    echo "$SMOKE_DMG_PATH"
    return 0
  fi

  local version expected
  version="$(node -p "require('./package.json').buildDisplayVersion || require('./package.json').version")"
  expected="release/${APP_NAME}-${version}-mac-arm64.dmg"
  if [[ -f "$expected" ]]; then
    echo "$expected"
    return 0
  fi

  local matches=()
  shopt -s nullglob
  matches=(release/"${APP_NAME}"-*-mac-arm64.dmg)
  shopt -u nullglob

  if [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"
    return 0
  fi

  log "ERROR: mac-arm64 dmg not found (expected ${expected})"
  if [[ ${#matches[@]} -gt 1 ]]; then
    log "ERROR: multiple mac-arm64 dmg candidates: ${matches[*]}"
  fi
  exit 1
}

strip_quarantine() {
  local target="$1"
  if xattr -lr "$target" 2>/dev/null | grep -q 'com.apple.quarantine'; then
    log "removing com.apple.quarantine (recursive) from: ${target}"
    xattr -dr com.apple.quarantine "$target"
    return 0
  fi
  log "no quarantine xattr under: ${target}"
  return 0
}

log_signature_status() {
  local codesign_out spctl_out spctl_code=0

  log "codesign assessment:"
  codesign_out="$(codesign -dv --verbose=2 "$APP_PATH" 2>&1)" || true
  while IFS= read -r line; do
    [[ -n "$line" ]] && log "  ${line}"
  done <<< "$codesign_out"

  spctl_out="$(spctl -a -vv --type execute "$APP_PATH" 2>&1)" || spctl_code=$?
  while IFS= read -r line; do
    [[ -n "$line" ]] && log "  spctl: ${line}"
  done <<< "$spctl_out"

  if [[ "$spctl_code" -eq 0 ]]; then
    log "gatekeeper: app accepted for launch"
    return 0
  fi
  log "WARN: gatekeeper rejected app (unsigned/unnotarized or needs manual approval)"
  return 1
}

prepare_app_for_silent_launch() {
  log "preparing app for silent launch (gatekeeper/quarantine)"
  strip_quarantine "$APP_PATH"

  if log_signature_status; then
    return 0
  fi

  if [[ "${SMOKE_REQUIRE_GATEKEEPER_PASS:-0}" == "1" ]]; then
    log "ERROR: gatekeeper check failed and SMOKE_REQUIRE_GATEKEEPER_PASS=1"
    log "hint: configure Developer ID signing + notarization in electron-builder.env"
    exit 1
  fi

  log "continuing smoke with quarantine cleared (gatekeeper may still block unsigned builds)"
}

resolve_app_binary() {
  local candidate="${APP_PATH}/Contents/MacOS/${APP_NAME}"
  if [[ -x "$candidate" ]]; then
    echo "$candidate"
    return 0
  fi
  find "${APP_PATH}/Contents/MacOS" -maxdepth 1 -type f -perm +111 2>/dev/null | head -1
}

launch_installed_app() {
  local app_bin launch_log_dir launch_log

  prepare_app_for_silent_launch

  launch_log_dir="${HOME}/Library/Application Support/${APP_NAME}/logs"
  mkdir -p "$launch_log_dir"
  launch_log="${launch_log_dir}/smoke-launch.log"

  app_bin="$(resolve_app_binary || true)"
  if [[ -n "${app_bin:-}" && -x "$app_bin" ]]; then
    log "launching main binary in background: ${app_bin}"
    log "launch stdout/stderr -> ${launch_log}"
    local -a launch_env=(CLAWX_CI_SMOKE=1)
    local smoke_var
    for smoke_var in \
      SMOKE_GLM_API_KEY \
      SMOKE_GLM_VENDOR_ID \
      SMOKE_GLM_MODEL_ID \
      SMOKE_GLM_LABEL \
      SMOKE_GLM_BASE_URL; do
      if [[ -n "${!smoke_var:-}" ]]; then
        launch_env+=("${smoke_var}=${!smoke_var}")
      fi
    done
    env "${launch_env[@]}" nohup "$app_bin" >>"$launch_log" 2>&1 &
  else
    log "main binary not found, falling back to: open -a ${APP_PATH}"
    open -a "$APP_PATH"
  fi

  log "waiting for ${APP_NAME} process to appear ..."
  for _ in $(seq 1 30); do
    if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      log "app process is running (pid $(pgrep -x "$APP_NAME" | head -1))"
      return 0
    fi
    sleep 1
  done

  log "ERROR: ${APP_NAME} did not start (gatekeeper/quarantine may have blocked launch)"
  log "hint: if dialog says 'downloaded from internet', run: xattr -dr com.apple.quarantine ${APP_PATH}"
  log "hint: launch via binary not 'open', or use locally built release/*.dmg (no browser download)"
  log "hint: launch log: ${launch_log}"
  exit 1
}

wait_for_gateway_ready() {
  local attempt=0
  local wait_start=$SECONDS
  local elapsed=0

  log "polling gateway immediately (every ${GATEWAY_POLL_INTERVAL_SEC}s, max ${GATEWAY_MAX_WAIT_SEC}s) ..."
  while (( elapsed < GATEWAY_MAX_WAIT_SEC )); do
    attempt=$((attempt + 1))
    log "gateway probe attempt ${attempt} ($((SECONDS - wait_start))s elapsed) ..."
    if node "$ROOT/scripts/gateway-ws-probe.mjs" \
      --port "$GATEWAY_PORT" \
      --timeout-ms "$GATEWAY_PROBE_TIMEOUT_MS"; then
      log "gateway ready in $((SECONDS - wait_start))s (${attempt} attempt(s))"
      return 0
    fi
    if (( elapsed + GATEWAY_POLL_INTERVAL_SEC >= GATEWAY_MAX_WAIT_SEC )); then
      break
    fi
    sleep "$GATEWAY_POLL_INTERVAL_SEC"
    elapsed=$((elapsed + GATEWAY_POLL_INTERVAL_SEC))
  done

  log "final gateway probe (${GATEWAY_MAX_WAIT_SEC}s budget exhausted) ..."
  if node "$ROOT/scripts/gateway-ws-probe.mjs" \
    --port "$GATEWAY_PORT" \
    --timeout-ms "$GATEWAY_PROBE_TIMEOUT_MS"; then
    log "gateway ready in $((SECONDS - wait_start))s (final attempt)"
    return 0
  fi
  log "gateway not ready within ${GATEWAY_MAX_WAIT_SEC}s ($((SECONDS - wait_start))s elapsed)"
  return 1
}

read_mount_point_from_attach() {
  local attach_out="$1"
  printf '%s' "$attach_out" | plutil -extract system-entities.0.mount-point raw - 2>/dev/null || true
}

install_dmg() {
  local dmg="$1"
  local app_src attach_out

  strip_quarantine "$dmg"

  log "attaching dmg (read-only): ${dmg}"
  if ! attach_out="$(hdiutil attach -nobrowse -readonly -plist "$dmg" 2>&1)"; then
    log "ERROR: hdiutil attach failed"
    while IFS= read -r line; do
      [[ -n "$line" ]] && log "  hdiutil: ${line}"
    done <<< "$attach_out"
    exit 1
  fi

  MOUNT_POINT="$(read_mount_point_from_attach "$attach_out")"
  if [[ -z "$MOUNT_POINT" || ! -d "$MOUNT_POINT" ]]; then
    log "ERROR: failed to parse dmg mount point"
    while IFS= read -r line; do
      [[ -n "$line" ]] && log "  hdiutil: ${line}"
    done <<< "$attach_out"
    exit 1
  fi
  log "mounted at: ${MOUNT_POINT}"

  app_src="${MOUNT_POINT}/${APP_NAME}.app"
  if [[ ! -d "$app_src" ]]; then
    log "ERROR: ${APP_NAME}.app not found inside dmg"
    exit 1
  fi

  strip_quarantine "$app_src"

  log "copying ${APP_NAME}.app to /Applications ..."
  ditto "$app_src" "$APP_PATH"

  detach_dmg

  if [[ ! -d "$APP_PATH" ]]; then
    log "ERROR: install failed, ${APP_PATH} missing"
    exit 1
  fi
  log "install finished: ${APP_PATH}"
}

teardown_mount_only() {
  # Only release a leftover dmg mount if install aborted mid-way; never quit the app.
  detach_dmg
}

trap teardown_mount_only EXIT

main() {
  local dmg
  local smoke_start=$SECONDS

  log "=== mac arm64 smoke test start ==="
  require_mac_arm64

  log "step 1/5: locate mac-arm64 dmg artifact"
  dmg="$(resolve_dmg)"
  log "using dmg: ${dmg} ($(du -h "$dmg" | awk '{print $1}'))"

  log "step 2/5: uninstall existing app and wipe config/data"
  cleanup_installation

  log "step 3/5: install dmg to /Applications"
  install_dmg "$dmg"

  log "step 4/5: launch app and verify gateway auto-start (no setup GUI)"
  launch_installed_app

  log "probing gateway ws://127.0.0.1:${GATEWAY_PORT}/ws ..."
  if wait_for_gateway_ready; then
    if [[ "${SMOKE_SKIP_E2E:-0}" != "1" ]]; then
      log "step 5/5: extended e2e (configure GLM-5.2 → gateway reload → chat date check)"
      node "$ROOT/scripts/ci-smoke-e2e.mjs"
    else
      log "step 5/5: skipped extended e2e (SMOKE_SKIP_E2E=1)"
    fi
    trap - EXIT
    log "=== mac arm64 smoke test PASSED ==="
    log "total smoke test time: $((SECONDS - smoke_start))s"
    log "leaving ${APP_NAME} installed at ${APP_PATH} and running (no post-test quit)"
    exit 0
  fi

  trap - EXIT
  detach_dmg

  log "=== mac arm64 smoke test FAILED ==="
  log "total smoke test time: $((SECONDS - smoke_start))s"
  log "leaving ${APP_NAME} running for inspection (no post-test quit)"
  log "hint: check ${HOME}/Library/Application Support/${APP_NAME}/logs for app logs"
  log "hint: launch log: ${HOME}/Library/Application Support/${APP_NAME}/logs/smoke-launch.log"
  log "CI will stop here (no rsync upload)"
  exit 1
}

main "$@"
