---
id: fix-autopilot-codex-provider
title: Preserve Local Codex Provider Configuration in Autopilot
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Use the local Codex model connection, including cc-switch, without importing unrelated user tools or publisher credentials into isolated workers.
touchedAreas:
  - harness/**
  - pnpm-lock.yaml
  - tests/unit/harness-autopilot.test.ts
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
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/harness-runner.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - Filtered TOML preserves provider endpoint, selected model, authentication, headers and network environment.
  - Temporary configuration and authentication are private and removed with the owned task HOME.
  - User hooks, MCP servers, plugins, trust settings, unsafe sandbox policies and GitHub credentials are not inherited.
  - A controlled local HTTP provider verifies adapter routing and structured output without external credentials.
  - Missing or invalid provider configuration never falls back silently to OpenAI.
docs:
  required: true
---

This maintenance task explicitly includes adding a TOML parser dependency to the development harness. It does not change YYClaw runtime communication or lower acceptance gates. Actual local Codex verification is separate from deterministic adapter tests and uses only a disposable owned workspace.
