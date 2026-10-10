---
id: repair-lint-baseline
title: Repair the Repository Lint Baseline
scenario: gateway-backend-communication
scenarios:
  - autonomous-development
taskType: runtime-bridge
featureIds:
  - F33
intent: Restore a green non-mutating lint gate without weakening source checks or changing product behavior.
touchedAreas:
  - eslint.config.mjs
  - electron/**
  - src/**
  - shared/**
  - tests/unit/**
  - tests/e2e/port-conflict-host-api.spec.ts
  - harness/specs/tasks/repair-lint-baseline.md
  - docs/ARCHITECTURE.md
  - docs/TROUBLESHOOTING.md
expectedUserBehavior:
  - Autonomous development no longer stops on existing source lint errors.
  - Generated artifacts and nested temporary worktrees are not linted as repository sources.
  - Existing UI interactions, communication routing and telemetry privacy remain unchanged.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - api-client-transport-policy
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm run lint:check
  - pnpm run typecheck
  - tests/unit/use-smooth-stream-text.test.ts
  - tests/unit/picker-session-order.test.ts
  - tests/unit/workflow-engine.test.ts
  - tests/unit/telemetry.test.ts
  - tests/unit/lint-baseline.test.ts
  - tests/unit/use-picker-session-order.test.tsx
  - tests/unit/baseline-host-services.test.ts
  - tests/e2e/port-conflict-host-api.spec.ts
acceptance:
  - Repository-wide lint exits successfully without disabling source rules or adding suppression directives.
  - Typecheck passes after removing legacy blanket TypeScript suppression directives.
  - Renderer backend calls use the shared host API entry points.
  - Existing unit tests, harness checks and communication replay/compare pass.
docs:
  required: true
---

This is a separately authorized baseline maintenance task, not an autonomous task that changes its own acceptance gates. Only generated output directories are excluded from source linting. Introductions need no update because no new product behavior is introduced.
