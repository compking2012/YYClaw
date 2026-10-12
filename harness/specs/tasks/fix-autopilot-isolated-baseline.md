---
id: fix-autopilot-isolated-baseline
title: Restore Isolated Baseline and Atomic Resource Leases
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Make autonomous baseline tests independent of personal HOME and outer pnpm workspaces, and serialize competing resource owners without lease publication races.
touchedAreas:
  - harness/src/autopilot/store.mjs
  - harness/src/autopilot/dependencies.mjs
  - harness/src/autopilot/engine.mjs
  - harness/src/autopilot/workspaces.mjs
  - harness/src/autopilot/acceptance.mjs
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/fixtures/cua-cli/openclaw-integration.mjs
  - src/components/channels/ChannelConfigModal.tsx
  - src/components/settings/ProvidersSettings.tsx
  - src/components/ui/modal-portal.tsx
  - src/pages/Chat/AcpMessageSegment.tsx
  - src/pages/Chat/ChatInput.tsx
  - src/pages/Chat/index.tsx
  - src/lib/workspace-context.ts
  - tests/unit/chat-input.test.tsx
  - tests/unit/chat-acp-page.test.tsx
  - tests/unit/workspace-context.test.ts
  - src/pages/Skills/index.tsx
  - src/stores/skills.ts
  - shared/i18n/locales/*/skills.json
  - tests/unit/skills-store-fetch-parallel.test.ts
  - tests/unit/modal-portal.test.tsx
  - tests/unit/provider-dialog.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - tests/e2e/fixtures/electron.ts
  - tests/e2e/fixtures/acp-errors.ts
  - tests/e2e/*.spec.ts
  - tests/e2e/chat-streamdown-rendering.spec.ts
  - tests/e2e/markdown-file-preview.spec.ts
  - harness/specs/tasks/fix-autopilot-isolated-baseline.md
  - harness/specs/rules/autonomous-development-safety.md
  - harness/FEATURE-MAP.md
  - harness/reference/autonomous-development.md
  - README*.md
  - resources/screenshot/**
  - docs/**
expectedUserBehavior:
  - Complete baseline tests pass under a private empty HOME without accessing personal OpenClaw voice settings.
  - Controlled package fixtures freeze their own lockfiles even when TMPDIR is nested in a real pnpm workspace.
  - Concurrent host and initialization leases preserve exclusive ownership across acquisition, release and dead-owner recovery.
requiredProfiles:
  - fast
requiredRules:
  - autonomous-development-safety
  - docs-sync
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - e2e-parallel-isolation
  - comms-regression
requiredTests:
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/provider-runtime-sync.test.ts
  - tests/unit/harness-runner.test.ts
  - tests/unit/cua-cli-exec.test.ts
  - tests/unit/modal-portal.test.tsx
  - tests/unit/acp-chat-components.test.tsx
  - pnpm run test:e2e
  - tests/unit/provider-dialog.test.tsx
acceptance:
  - The provider delivery suite mocks the voice configuration boundary, asserts deletion delivery and never relies on real user configuration.
  - Real controlled package installation retains offline, incremental-version, lifecycle and copied-dependency isolation assertions with a fixture-owned workspace root.
  - A lease is published atomically with complete ownership metadata; contenders cannot read an empty lease or fail when a former owner releases.
  - Dead-owner recovery has one exclusive owner, repeated release preserves a successor and unknown or corrupt leases are retained for manual verification.
  - Full unit tests, lint, typecheck, build and harness checks execute under an isolated HOME with no baseline exemptions.
  - Dependency initialization uses the locked sharp prebuilt native dependency, avoids global Homebrew/libvips discovery and still verifies real native image processing.
  - Electron fixtures resolve real production resources from the repository rather than the temporary bundle directory; history-specific tests explicitly select their intended conversation after fresh-conversation startup.
  - The Electron launcher waits for the actual initial Renderer surface after Main registers handlers before tests install IPC overrides; repeated launches preserve that ordering without fixed sleeps or startup retries.
  - Electron settings tests exercise the real tabbed settings modal, typed host API fixtures and canonical persisted skill names instead of removed routes or obsolete display text.
  - POSIX CUA integration keeps a private short socket path below the platform limit even when the worktree HOME is long; the parent owns and removes its separate socket directory.
  - Portaled modals deliver React focus and blur callbacks before suppressing outer document focus traps, including first entry and listener cleanup.
  - Feishu creation retains the existing quick-command explanation and distinguishes successful creation from optional Lark CLI sign-in readiness; gateway-backend-communication remains the reference boundary and communication regressions execute.
  - Preflight separately reports changed files, stale plan and current SHAs, unpublished target SHAs and task-budget exhaustion without allocating a workspace or publishing user changes.
  - Long unbroken user text wraps anywhere within a narrow chat viewport without horizontal message overflow, while literal text and assistant Markdown rendering remain unchanged.
  - Error integration tests use the active ACP load/prompt/update contract rather than the retired Gateway chat transport, assert a real terminal failure and dismissal, retain failed closing-tool evidence and usable output, and reject duplicate notices; legacy collapsible classification remains covered by component tests.
  - The provider dialog uses the shared real opening and closing transition, stays centered, preserves close-time content and resets the form after closing; settings navigation explicitly closes the enclosing modal.
  - Skill uninstall retains an in-flight disabled localized action across detail reopening, removes confirmed-deleted skills before refreshing and keeps failed uninstall entries available for retry.
  - The canonical main session ignores stale workspace metadata without requiring a caller-supplied default; initializing a locally disabled composer does not falsely claim a disconnected running Gateway.
  - Provider API-key validation failures remain visible inline and clear on key editing; deterministic catalog tests use the committed local catalog without changing remote-catalog production behavior.
  - Workflow decomposition shows session-scoped thinking feedback and disables duplicate submissions until the routing result arrives; existing inline, floating-panel and deletion behavior remains tested.
  - UI regression fixtures reload only after installing host responses, await confirmed maintenance persistence, freeze exit animation to inspect copy, and exercise the current conversation-label, voice-capability and voice transcription contracts without restoring retired UI routes.
  - Usage overview filters internal runtime markers but preserves historical model usage independently of current provider accounts; both UI checks execute rather than remain unconditionally skipped.
  - Playwright file checks and registered E2E/performance scripts emit structured reports; absent, invalid, empty, failed or flaky reports fail acceptance, and directed or acceptance-mapped checks reject skips regardless of declared kind. Only controller-added whole-suite quality checks preserve platform exclusions without certifying a requirement.
docs:
  required: true
---

These baseline repairs are reviewed controller/test changes, not permission for autonomous workers to weaken acceptance or edit user configuration. Real model connectivity, real GitHub delivery and cross-platform CI certification are recorded separately from controlled integration tests. No local fix alone marks F33 DONE.
