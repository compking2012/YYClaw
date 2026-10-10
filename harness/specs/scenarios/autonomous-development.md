---
id: autonomous-development
title: Autonomous Development and Per-task Delivery
type: development-tooling
ownedPaths:
  - harness/**
  - tests/unit/harness*.test.ts
  - .github/workflows/**
  - package.json
  - README*.md
  - docs/**
requiredProfiles:
  - fast
requiredRules:
  - autonomous-development-safety
  - docs-sync
---

Source: [F33 requirement](../../../docs/FEATURELIST.md), [architecture](../../../docs/ARCHITECTURE.md), and [documentation ownership](../../../docs/DOCUMENTATION.md).

Development automation is a repository tool, not an OpenClaw product-runtime feature. It derives bounded tasks from committed requirements, freezes acceptance, executes isolated coding and independent validation, publishes one draft PR per task, and removes owned workspaces immediately after durable publication. CI repairs reconstruct temporary workspaces from published commits. Completion requires current-commit evidence and verified cleanup, not an agent's assertion.
