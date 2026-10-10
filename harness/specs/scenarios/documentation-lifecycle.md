---
id: documentation-lifecycle
title: Documentation Layers and Delivery Promotion
type: documentation
ownedPaths:
  - README*.md
  - docs/**
  - harness/**
  - AGENTS.md
  - .gitignore
requiredRules:
  - docs-sync
---

Source: [documentation contract](../../../docs/DOCUMENTATION.md) and [feature coverage](../../FEATURE-MAP.md).

Requirements and technical design may be pending in root development documents. Harness derives bounded implementation/validation work from the complete feature breakdown. Public READMEs and four-locale guides describe only implemented scope with actual gates and prerequisites. Coverage maps distinguish linked tasks from uncovered backlog. The local collaboration draft is not a tracked dependency.

Documentation-only changes do not require Electron UI tests or screenshot regeneration. Validate the affected specs, documentation links, feature-ID coverage and locale parity. Existing runtime/UI changes still require their respective scenarios and checks.
