---
id: autonomous-development-safety
title: Autonomous Development Safety and Cleanup
type: ai-coding-rule
appliesTo:
  - autonomous-development
---

- Start only from committed inputs; never stash, commit, or clean user changes.
- Freeze versioned plans, acceptance, dependencies and exact write scopes outside worker workspaces.
- Validate all required tests, structured change tags, evidence and actual exit results. Missing conditions are blocked, not passed.
- Workers do not receive GitHub/publishing credentials. No dangerous sandbox bypass, arbitrary model-generated shell commands, gate weakening, automatic merge or release.
- Dependencies, runtime patches, CI infrastructure and publishing configuration need explicit risk authorization; authorization never permits test weakening.
- Publish per-task draft PRs in deterministic topological order. Evidence is tied to the published SHA, including after stack repairs.
- Before removing a workspace, persist evidence and either verify published SHA/PR or archive the recoverable changes.
- Cleanup touches only recorded run/task-owned directories and processes. Preserve primary workspaces, foreign data, shared caches, remote branches and durable evidence.
- Cleanup is idempotent and required for completion. A cleanup failure blocks new workspace allocation.
- Recreate CI repair workspaces rather than retaining published workspaces. Cancel and timeout preserve recovery evidence before cleanup.
