---
id: fix-dreams-toggle-config-authoritative
title: Fix dreaming enable toggle losing state on Memory page re-mount
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Make the Memory (Dreams) page enable/disable toggle authoritative from persisted config (config.get) instead of the lagging runtime doctor.memory.status, so the toggle survives leaving and re-entering the page after config.patch hot-applies.
touchedAreas:
  - harness/specs/tasks/fix-dreams-toggle-config-authoritative.md
  - src/pages/Dreams/index.tsx
  - tests/unit/dreams-page.test.tsx
  - tests/e2e/openclaw-dreams.spec.ts
expectedUserBehavior:
  - Enabling dreaming persists via config.patch and the toggle immediately shows the enabled state.
  - Leaving the Memory tab and returning keeps the toggle in the last-set state, even before runtime status catches up.
  - Disabling dreaming behaves symmetrically.
  - Runtime metrics/phases from doctor.memory.status converge in-session without a gateway restart.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - backend-communication-boundary
  - active-config-guards
  - comms-regression
requiredTests:
  - pnpm run typecheck
  - tests/unit/dreams-page.test.tsx
  - tests/e2e/openclaw-dreams.spec.ts
acceptance:
  - The enable toggle display derives from persisted config (config.get plugins.entries.memory-core.config.dreaming.enabled), falling back to doctor.memory.status only when the config value is absent.
  - config.get is read on mount/refresh independently, so the toggle stays correct even when doctor.memory.status is still initializing.
  - Toggling calls config.get + config.patch (with baseHash) and relies on native hot reload; it never calls config.apply, gateway restart, or SIGUSR1.
  - After toggling, doctor.memory.status is polled a bounded number of times to converge runtime metrics; poll timeout is silent and does not escalate to restart.
  - Renderer does not add direct IPC calls and does not fetch Gateway HTTP directly; all RPC goes through useGatewayStore().rpc.
docs:
  required: false
---

Use this task spec when changing how the Memory (Dreams) page reads or writes the dreaming.enabled state across the renderer/Gateway boundary. Root cause: the toggle previously rendered from the runtime doctor.memory.status, which lags a config.patch until the memory-core plugin reloads, so re-mounting the page showed a stale disabled state. Fix keeps native hot reload (per fix-model-switch-native-hot-reload) and makes the persisted config authoritative for display.
