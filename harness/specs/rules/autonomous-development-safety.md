---
id: autonomous-development-safety
title: Autonomous Development Safety and Cleanup
type: ai-coding-rule
appliesTo:
  - autonomous-development
---

- Start only from committed inputs; never stash, commit, or clean user changes.
- Freeze versioned plans, acceptance, dependencies and exact write scopes outside worker workspaces.
- Before freezing a generated proposal, the controller adds universal docs-sync and change-tag-mandated rules, records additions and validates the resulting contract. Only rule strengthening is automatic; loaded frozen plans, acceptance, checks, scopes and source identity are never rewritten to pass validation.
- Validate all required tests, structured change tags, evidence and actual exit results. Missing conditions are blocked, not passed.
- Coding workers may return validation-pending when their sandbox prevents local tests; this is not acceptance. Execute all frozen checks in the controller's owned, credential-isolated workspace environment. Do not broaden the model sandbox or suppress assertions to enable loopback/process/UI tests. Genuine missing requirements and external prerequisites remain blocked. Read-only review inspects the controller's recorded evidence rather than rerunning system-resource suites in its own sandbox.
- Independent review returns exactly one passing verdict per frozen acceptance ID; duplicates, omissions and foreign verdicts cannot turn passing local commands into delivery acceptance.
- Before coding, the controller verifies same-task/resource/base-SHA startup receipts for lifecycle installation, bridge generation and typecheck. Workers read this evidence under the AGENTS.md controller-owned startup exception, never rerun broad setup beyond their frozen write scope, and never treat startup success as task/resource acceptance.
- Workers do not receive GitHub/publishing credentials. No dangerous sandbox bypass, arbitrary model-generated shell commands, gate weakening, automatic merge or release.
- Preserve the local Codex model/provider connection in private task-local configuration. Inherit only model authentication and required network variables; never import user hooks, MCP servers, plugins, trust policies or publisher credentials. Invalid configuration must fail instead of silently falling back to another provider.
- Dependencies, runtime patches, CI infrastructure and publishing configuration need explicit risk authorization; authorization never permits test weakening.
- Publish per-task draft PRs in deterministic topological order. Evidence is tied to the published SHA, including after stack repairs.
- Before removing a workspace, persist evidence and either verify published SHA/PR or archive the recoverable changes.
- Cleanup touches only recorded run/task-owned directories and processes. Preserve primary workspaces, foreign data, shared caches, remote branches and durable evidence.
- Cleanup is idempotent and required for completion. A cleanup failure blocks new workspace allocation.
- Resolve shared dependency/download caches under the primary project's dedicated `node_modules/.autopilot-cache/` before isolating HOME; never reuse its writable installed dependency tree or follow symlinked cache paths. Keep each workspace's copied dependencies and lifecycle outputs private. Preserve shared caches during cleanup, never bypass required lifecycle scripts, and report initialization failures separately from coding repairs.
- Recreate CI repair workspaces rather than retaining published workspaces. Cancel and timeout preserve recovery evidence before cleanup.
- Publish complete resource leases atomically, serialize dead-owner recovery and preserve unknown leases. Baseline fixtures own their pnpm workspace roots and mock personal configuration boundaries; passing under the user's HOME alone does not certify isolated execution.
- Reuse installed uv only after actual version, executable platform/architecture and receipt verification; copy task outputs and retain required downloads on mismatch. Model connectivity cannot substitute for GitHub release connectivity. Do not classify a confirmed setup download failure as a coding defect or skip lifecycle gates to pass.
