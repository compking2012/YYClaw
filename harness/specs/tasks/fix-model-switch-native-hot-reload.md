---
id: fix-model-switch-native-hot-reload
title: Make model switches converge without restarting Gateway
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Use OpenClaw's native config watcher for model changes and acknowledge the live runtime model before the UI can send again.
touchedAreas:
  - harness/specs/tasks/fix-model-switch-native-hot-reload.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - docs/ARCHITECTURE.md
  - docs/PRODUCT.md
  - electron/gateway/config-refresh-scheduler.ts
  - electron/gateway/manager.ts
  - electron/api/routes/channels.ts
  - electron/api/routes/skills.ts
  - electron/main/ipc-handlers.ts
  - electron/services/agents-api.ts
  - electron/api/routes/agents.ts
  - electron/services/providers/provider-runtime-sync.ts
  - electron/services/admin-console/remote-sync/apply-agents-set-model.ts
  - electron/services/admin-console/remote-sync/apply-agents-set-default.ts
  - electron/services/admin-console/remote-sync/apply-models-set-default-primary.ts
  - src/pages/Chat/ChatInput.tsx
  - tests/unit/config-refresh-scheduler.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-model-picker.spec.ts
expectedUserBehavior:
  - Switching an agent or default model does not restart the Gateway process or WebSocket service.
  - The model update completes only after the live agents.list snapshot exposes the selected effective model.
  - Chat send remains disabled while a model switch is waiting for runtime convergence.
  - A convergence timeout reports an error without escalating to SIGUSR1 or process restart.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - gateway-readiness-policy
  - backend-communication-boundary
  - renderer-main-boundary
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/config-refresh-scheduler.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/host-services.test.ts
  - tests/e2e/chat-model-picker.spec.ts
acceptance:
  - Ordinary openclaw.json writes rely on the OpenClaw native watcher and never call config.apply after writing the file.
  - Model-changing flows poll agents.list, which reads the live runtime config, until the expected model is visible.
  - Convergence polling is bounded and coalesces concurrent waits for the same target state.
  - Poll failure or timeout never invokes debouncedReload, debouncedRestart, restart, or SIGUSR1.
  - Explicit restart-only operations retain their existing restart behavior.
  - Focused tests, harness validation, communication replay, and communication compare pass.
docs:
  required: true
---

## Background

YYClaw previously wrote `openclaw.json` and then called `config.apply`
without the required `baseHash`. OpenClaw rejected that duplicate write, and the
fallback sent SIGUSR1, which restarts the Gateway service. The native watcher had
usually already hot-applied the model change before this unnecessary fallback.

## Scope

- Remove the duplicate config.apply and signal fallback from ordinary config writes.
- Keep native watcher hot reload as the config application mechanism.
- Wait for the live agent runtime model before completing model-switch requests.
- Preserve explicit restarts for restart-only operations.

## Out Of Scope

- Migrating every OpenClaw config mutation to Gateway-owned config.patch calls.
- Changing the OpenClaw reload planner or watcher implementation.
- Removing explicit restarts for destructive agent, server, or plugin operations.
