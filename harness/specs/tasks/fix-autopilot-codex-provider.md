---
id: fix-autopilot-codex-provider
title: Preserve Local Codex Provider Configuration in Autopilot
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Use the local Codex model connection, including cc-switch, without importing unrelated user tools or publisher credentials into isolated workers.
touchedAreas:
  - AGENTS.md
  - harness/**
  - pnpm-lock.yaml
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/harness-autopilot-frozen-contract.test.ts
  - README*.md
  - docs/**
expectedUserBehavior:
  - Planning, coding and review use the locally configured Codex provider and model.
  - Task isolation preserves model authentication and network settings but excludes publishing credentials and user hooks.
  - Invalid local configuration fails explicitly instead of silently selecting another provider.
requiredProfiles:
  - fast
requiredRules:
  - autonomous-development-safety
  - docs-sync
requiredTests:
  - tests/unit/harness-autopilot-frozen-contract.test.ts
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/harness-runner.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - Code-ready workers can report validation-pending for local sandbox restrictions; the controller still executes all frozen and mandatory checks and independently reviews current evidence before PR publication.
  - Actual loopback and subprocess integration checks run through the controller runner, retaining private HOME and credential isolation. Genuine blocked implementations, failed tests, missing external prerequisites, unauthorized writes and empty patches cannot publish or become ready.
  - Coding and read-only review prompts explicitly assign full-suite and system-resource tests to the controller without widening Codex sandbox permissions or reclassifying historical blocked reports by string matching.
  - Independent review rejects duplicate, missing, foreign or failing acceptance verdicts even when every local test command has passed; exactly one passing verdict per frozen ID is mandatory.
  - Filtered TOML preserves provider endpoint, selected model, authentication, headers and network environment.
  - Temporary configuration and authentication are private and removed with the owned task HOME.
  - User hooks, MCP servers, plugins, trust settings, unsafe sandbox policies and GitHub credentials are not inherited.
  - A controlled local HTTP provider verifies adapter routing and structured output without external credentials.
  - Missing or invalid provider configuration never falls back silently to OpenAI.
  - Capability preflight validates the actual exec arguments in help mode without model execution and accepts brief or stderr help output.
  - The launch PATH executable is pinned across planning, repeated preflight and worker execution; unsupported arguments and missing executables fail with explicit diagnostics.
  - The real-Git two-task stack regression completes within its scoped 30-second allowance under full-suite contention, retaining publication, cleanup-before-CI, main-worktree isolation and readiness assertions; global test and runtime deadlines are unchanged.
  - Controller startup receipts match the task/resource/base SHA and record actual install, bridge and typecheck success; workers reuse verified initialization without rerunning broad setup outside their frozen write scope. Missing, altered, foreign or failed evidence prevents coding and never substitutes for task acceptance.
docs:
  required: true
---

This maintenance task explicitly includes adding a TOML parser dependency to the development harness. It does not change YYClaw runtime communication or lower acceptance gates. Actual local Codex verification is separate from deterministic adapter tests and uses only a disposable owned workspace.
