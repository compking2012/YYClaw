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
- Preserve the local Codex model/provider connection in private task-local configuration. Inherit only model authentication and required network variables; never import user hooks, MCP servers, plugins, trust policies or publisher credentials. Invalid configuration must fail instead of silently falling back to another provider.
- Dependencies, runtime patches, CI infrastructure and publishing configuration need explicit risk authorization; authorization never permits test weakening.
- Publish per-task draft PRs in deterministic topological order. Evidence is tied to the published SHA, including after stack repairs.
- Before removing a workspace, persist evidence and either verify published SHA/PR or archive the recoverable changes.
- Cleanup touches only recorded run/task-owned directories and processes. Preserve primary workspaces, foreign data, shared caches, remote branches and durable evidence.
- Cleanup is idempotent and required for completion. A cleanup failure blocks new workspace allocation.
- Resolve shared dependency/download caches under the primary project's dedicated `node_modules/.autopilot-cache/` before isolating HOME; never reuse its writable installed dependency tree or follow symlinked cache paths. Keep each workspace's copied dependencies and lifecycle outputs private. Preserve shared caches during cleanup, never bypass required lifecycle scripts, and report initialization failures separately from coding repairs.
- Recreate CI repair workspaces rather than retaining published workspaces. Cancel and timeout preserve recovery evidence before cleanup.
- Reuse installed uv only after actual version, executable platform/architecture and receipt verification; copy task outputs and retain required downloads on mismatch. Model connectivity cannot substitute for GitHub release connectivity. Do not classify a confirmed setup download failure as a coding defect or skip lifecycle gates to pass.
