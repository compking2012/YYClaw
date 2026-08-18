# Post-Merge Sidebar and Workspace Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Sidebar navigation, make first-run ACP default-workspace loading reliable, and unify Sidebar text sizing.

**Architecture:** Route repair stays in the renderer router. Default-workspace creation stays in Electron Main and is an explicit, narrowly-authorized input to the existing canonical access registry. Styling reuses the existing Sidebar typography token.

**Tech Stack:** Electron, React Router, React 19, TypeScript, Vitest, Playwright.

---

### Task 1: Lock the regressions with tests

**Files:**
- Modify: `tests/e2e/main-navigation.spec.ts`
- Modify: `tests/unit/acp-session-access-registry.test.ts`
- Modify: `tests/unit/sidebar-session-buckets.test.ts`

- [ ] Update the navigation E2E to click Models, Agents, Channels, Skills, and Settings directly and assert the matching page test ids and hash routes.
- [ ] Add a registry test that passes a missing workspace with `{ createWorkspaceRoot: true }` and expects canonical directories.
- [ ] Add a registry assertion that the same missing workspace is rejected when creation is not enabled.
- [ ] Add Sidebar assertions that workspace/session buttons contain `sidebar-nav-text`.
- [ ] Run the focused tests and confirm they fail for the missing behavior.

### Task 2: Restore all Sidebar routes

**Files:**
- Modify: `src/App.tsx`

- [ ] Import `UsageSettings`, `ChannelsSettings`, `SkillsSettings`, `MemorySettings`, `ImageGenerationPage`, and `SystemSettingsTab`.
- [ ] Register `/models`, `/channels`, `/skills`, `/image-generation`, `/dreams`, and `/settings/*` under `MainLayout`, preserving dev-mode guards.
- [ ] Run the navigation regression and confirm it passes.

### Task 3: Create only the managed default ACP workspace

**Files:**
- Modify: `electron/services/acp-session-access-registry.ts`
- Modify: `electron/services/acp-chat-service.ts`
- Modify: `harness/specs/tasks/chat-workspace-context.md`

- [ ] Add the optional `createWorkspaceRoot` preparation option and create the root recursively before canonicalization only when enabled.
- [ ] In `AcpChatService`, enable creation only when `createIfMissing` is true and both payload paths equal `DEFAULT_WORKSPACE_CWD`.
- [ ] Document the behavior in the existing chat workspace harness task.
- [ ] Run ACP registry/service tests and confirm they pass.

### Task 4: Unify Sidebar typography

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] Replace workspace and session primary text size classes with `sidebar-nav-text`.
- [ ] Run the Sidebar unit regression and confirm it passes.

### Task 5: Verify without disturbing unrelated merge work

**Files:**
- Review: `README.md`
- Review: `README.zh-CN.md`
- Review: `README.ja-JP.md`

- [ ] Run focused Vitest and Playwright coverage.
- [ ] Run `pnpm harness validate --spec harness/specs/tasks/chat-workspace-context.md`.
- [ ] Run `pnpm run typecheck`, `pnpm run build:vite`, `pnpm run comms:replay`, and `pnpm run comms:compare`.
- [ ] Review the three README variants; no update is expected because this restores already-documented behavior.
- [ ] Report any verification blocked by the pre-existing unresolved merge or unavailable dependencies.
