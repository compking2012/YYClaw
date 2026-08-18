---
id: migrate-legacy-cron-json-to-sqlite
title: Migrate legacy cron JSON jobs into SQLite on upgrade
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: After OpenClaw 2026.6.5 drops legacy cron jobs.json data during its JSON-to-SQLite migration, ClawX rescues user-created jobs by re-creating them via the cron.add Gateway RPC on first gateway:ready, then archives the legacy JSON files. Internal [managed-by=...] jobs are skipped so the runtime rebuilds them itself.
touchedAreas:
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - README.ru-RU.md
  - electron/services/cron-legacy-migrate.ts
  - electron/services/cron-api.ts
  - electron/gateway/manager.ts
  - tests/unit/cron-legacy-migrate.test.ts
  - harness/specs/tasks/migrate-legacy-cron-json-to-sqlite.md
expectedUserBehavior:
  - No visible UI prompts; migration runs silently in the main process after the Gateway becomes ready.
  - On first launch after upgrading to the SQLite-backed cron store, user-created scheduled tasks reappear in the Cron page without manual action.
  - Runtime-internal [managed-by=...] cron jobs are NOT re-created by ClawX; the runtime is responsible for rebuilding them.
  - Re-running (relaunch / reconnect) is a no-op once the legacy JSON files have been archived.
  - If some user jobs fail to migrate, the legacy JSON files are left in place so the next launch retries them; already-migrated jobs are not duplicated (cron.list dedupe).
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - docs-sync
requiredTests:
  - tests/unit/cron-legacy-migrate.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - electron/services/cron-legacy-migrate.ts reads ~/.openclaw/cron/jobs.json(.bak|.migrated), filters eligible user jobs, and re-creates each via gatewayManager.rpc('cron.add', ...).
  - [managed-by=...] jobs and disabled jobs are skipped; malformed schedules and jobs without a message are skipped.
  - On full success (or no eligible jobs but source files present), legacy JSON files are moved to ~/.openclaw/cron/legacy-archive/<timestamp>/; runs/*.jsonl is untouched.
  - On any per-job cron.add failure, legacy files are NOT archived so the next launch retries.
  - The migration is fired from the gateway:ready listener in electron/gateway/manager.ts as a fire-and-forget, non-blocking task guarded by an in-flight guard.
  - No new renderer/Main IPC surface is added; the Gateway RPC path is used per the renderer-main boundary policy.
docs:
  required: false
---

Use this spec when changing the legacy cron JSON -> SQLite rescue migration logic or its gateway:ready trigger point.
