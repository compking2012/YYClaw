---
id: fix-autopilot-planning-rule-policy
title: Complete Mandatory Planning Rules Before Freezing
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Make universal and tagged planning rules controller-owned so a model omission does not abort otherwise valid planning or weaken frozen acceptance.
touchedAreas:
  - harness/src/autopilot/planner.mjs
  - harness/src/autopilot/contracts.mjs
  - tests/unit/harness-autopilot.test.ts
  - harness/specs/rules/docs-sync.md
  - harness/specs/rules/autonomous-development-safety.md
  - harness/FEATURE-MAP.md
  - harness/README.md
  - harness/reference/autonomous-development.md
  - README*.md
  - docs/**
expectedUserBehavior:
  - Test-only tasks retain documentation impact review without requiring unnecessary documentation edits.
  - Newly generated proposals acquire mandatory rules before validation and freezing without an extra model request.
  - Loaded frozen plans still reject missing rules rather than silently changing their contract.
requiredProfiles:
  - fast
requiredRules:
  - autonomous-development-safety
  - docs-sync
requiredTests:
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/harness-specs.test.ts
acceptance:
  - Every newly generated task retains docs-sync; communication and UI tags acquire the corresponding mandatory rules.
  - Completion is idempotent and never mutates the proposal, acceptance, tests, write scope, dependencies, tags or input SHA.
  - Unknown rules, unsafe sources, unauthorized writes and invalid acceptance continue to fail existing validation.
  - The proposal hash and rule additions are recorded, and frozen JSON, manifest hash and Markdown contain the strengthened rules.
  - Planning worktrees are archived and cleaned on validation success or failure.
docs:
  required: true
---

The policy applies only to generated proposals before freezing. It never rewrites loaded plans or existing run contracts, removes requirements, disables checks or grants infrastructure risk authorization. Missing external sandbox prerequisites remain delivery blockers.
