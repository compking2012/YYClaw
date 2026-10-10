---
id: implement-autonomous-development
title: Implement Bounded Autonomous Development with Per-task PR Cleanup
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Extend the existing harness with deterministic planning, coding, acceptance, publication, cleanup and recovery without changing YYClaw runtime communication.
touchedAreas:
  - harness/**
  - tests/unit/harness*.test.ts
  - .github/workflows/**
  - package.json
  - README*.md
  - docs/**
expectedUserBehavior:
  - A committed feature goal produces a validated bounded plan and isolated per-task development.
  - Required acceptance executes with independent evidence and bounded repairs.
  - Each published task has one draft PR and no remaining owned workspace before CI polling.
  - Resume and CI repair preserve published identity while rebuilding temporary workspaces.
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
  - Plans validate feature references, DAG, scope, frozen acceptance and registered test commands.
  - Worktree removal requires matching ownership and durable evidence; foreign and unbacked work is retained.
  - Publication and repair are idempotent and all required CI checks refer to the current published SHA.
  - Fake coding and GitHub adapters exercise real isolated Git publication, cleanup, cancellation and repair.
  - Missing external acceptance, protected changes, weakened tests and exhausted budgets cannot pass.
docs:
  required: true
---

This task implements F33 developer tooling. Existing Electron UI and communication tests remain the reused acceptance tools; the desktop runtime is unchanged. Real model/GitHub execution requires explicit user setup and is not performed by implementation tests. Targeted integration tests use real disposable Git repositories and controlled adapters, never the developer's private profile.
