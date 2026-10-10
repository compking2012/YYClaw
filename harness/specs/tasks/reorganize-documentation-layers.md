---
id: reorganize-documentation-layers
title: Separate Introduction, Development and Implementation Documentation
scenario: documentation-lifecycle
taskType: documentation
intent: Establish PRD-derived implementation traceability and keep multilingual introductions limited to implemented scope.
featureIds:
  - F01
  - F26
  - F31
touchedAreas:
  - README*.md
  - docs/**
  - harness/**
  - AGENTS.md
  - .gitignore
expectedUserBehavior:
  - All four README and guide locales introduce implemented capabilities only.
  - Development documents retain both implemented and pending requirements with explicit delivery boundaries.
  - The multi-Agent draft stays on disk but is no longer tracked by Git.
requiredRules:
  - docs-sync
requiredTests:
  - pnpm harness validate --spec harness/specs/tasks/reorganize-documentation-layers.md --since HEAD
  - pnpm harness run --spec harness/specs/tasks/reorganize-documentation-layers.md --since HEAD --dry-run
  - pnpm run harness:ci
acceptance:
  - PRODUCT, FEATURELIST and ARCHITECTURE have explicit development ownership and a derivation workflow.
  - Every stable FEATURELIST ID appears in the harness coverage index with existing coverage or an explicit gap.
  - All four localized introductions exclude target local-cloud architecture and product-roadmap sections.
  - Public documentation links use the corresponding locale guides, and tracked documents do not depend on the local draft.
  - Git excludes the multi-Agent draft while the local file remains intact.
docs:
  required: true
---

## Scope and Validation

This is documentation-only: no Renderer/Main communication, UI implementation, or product delivery status changes. Preserve pre-existing edits. Reference [DOCUMENTATION](../../../docs/DOCUMENTATION.md), [FEATURELIST](../../../docs/FEATURELIST.md), and [FEATURE-MAP](../../FEATURE-MAP.md). Verify local links, four-locale scope/heading parity, complete feature-ID coverage, and Git/local-file state in addition to harness validation. No runtime validation profile is selected because no executable behavior is changed; harness CI is the baseline gate.
