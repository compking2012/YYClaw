---
id: fix-autopilot-shared-dependencies
title: Share Incremental Dependency Downloads and Diagnose Initialization Timeouts
scenario: autonomous-development
taskType: development-tooling
featureIds:
  - F33
intent: Share a project-local pnpm store under node_modules/.autopilot-cache across isolated workspaces while preserving independent dependency trees, lifecycle scripts, acceptance and resource cleanup.
touchedAreas:
  - harness/**
  - scripts/download-release.mjs
  - scripts/fix-electron-dev-arch.mjs
  - scripts/bundled-uv-cache.mjs
  - scripts/download-bundled-uv.mjs
  - tests/unit/harness*.test.ts
  - tests/unit/download-release.test.ts
  - tests/unit/bundled-uv-cache.test.ts
  - README*.md
  - docs/**
expectedUserBehavior:
  - Existing packages are reused and missing versions are downloaded incrementally into one persistent store.
  - Initialization is serialized, bounded and observable without exposing publisher credentials.
  - Cleanup removes task dependencies and temporary resources but preserves shared package and binary caches.
requiredProfiles:
  - fast
requiredRules:
  - autonomous-development-safety
  - docs-sync
requiredTests:
  - tests/unit/bundled-uv-cache.test.ts
  - tests/unit/harness-autopilot.test.ts
  - tests/unit/harness-runner.test.ts
  - tests/unit/harness-specs.test.ts
  - tests/unit/download-release.test.ts
acceptance:
  - Native uv matching the frozen version is verified by executable header and actual version, copied through a receipt-backed cache and kept independent per workspace; mismatches retain required downloads.
  - Nested pnpm lifecycle commands reuse the controller CLI rather than bootstrapping Corepack in temporary HOME.
  - Observed bundled GitHub download failures report sanitized assets and network prerequisites as blocked without spending coding repairs.
  - Independent workspaces use the same resolved project-local store under node_modules/.autopilot-cache, copy packages, preserve version isolation and support offline reuse.
  - New dependency versions supplement the store without changing existing versions or the primary workspace.
  - Initialization retains required lifecycle scripts and safely inherits only network and mirror settings.
  - Initialization reports include stages, deadlines, exits and logs; failures do not consume coding repairs.
  - Binary downloads are integrity-checked in persistent caches and materialized separately per workspace.
  - Resume preserves deadlines and frozen inputs while relocating legacy cache metadata without deleting old caches.
  - Cache validation rejects run artifacts, installed dependency trees and symlinked project cache paths.
  - Obsolete workspaces are removed only after ownership verification and durable recovery archival; plans, run evidence and primary dependencies remain intact.
docs:
  required: true
---

This user-authorized infrastructure maintenance does not change product runtime communication, pnpm's pinned version, dependency versions or acceptance gates. Existing host-resource lock defects remain independent issues and are not bypassed by cache reuse.
