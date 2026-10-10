# Autonomous Development: Implementation and Safety

## Implemented Architecture

The repository harness exposes `autopilot plan/run/status/resume/cancel`. The development scheduler uses XState independently of Electron and the OpenClaw workflow engine. Codex performs read-only planning and review plus restricted workspace coding; Claude is an explicitly unsupported reserved adapter. No unsafe sandbox bypass is used.

Plans use Zod-validated version-1 JSON and frozen hashes. Exact write paths, task dependencies, structured tags, registered check commands, rule/source references and acceptance mappings are validated. The default budget is 8 tasks, 2 independent coding tasks, 3 repairs and 6 hours. Task Markdown is generated outside coding worktrees. Existing specs remain readable; autonomous plans must declare acceptance explicitly.

The initial committed SHA must match the remote target branch. An owned baseline worktree runs pinned dependency initialization, existing extension bridge generation, lint, typecheck, unit tests, build and harness checks before task coding. Validation acquires a cross-run host-resource lease. A failed baseline is not automatically edited, and no coding starts until it passes. Task source/spec references and UI/comms rule selection are checked before execution.

## State and Evidence

Run state, events, plans, task Markdown and attempt logs live under `artifacts/autopilot/<run-id>/`. JSON updates are atomic. A runner lock prevents concurrent owners; cancellation uses a durable marker. Working trees live in owned task containers within that directory, separately from durable task evidence. No database or runtime Gateway is involved.

Task phases are coding, accepting, local-pass, publishing, cleaning, waiting-ci and complete. Blocked, failed and cleanup-failed do not represent successful delivery. Global run transitions use a persisted XState snapshot. A new process reconstructs owned resources and revalidates evidence rather than continuing an unverified in-memory step. Deadline and repair limits survive resume.

Validation executes registered commands without a shell, including declared checks and mandatory baseline lint/typecheck/unit/build/harness gates. UI and communication tags add Electron E2E and comms replay/compare. Missing authorized sandbox variables are blocked. Vitest targeted checks write JSON results and reject skipped/empty suites; independent review checks every acceptance ID and actual logs. Unmapped evidence, undeclared UI/comms changes, scope escapes, test skipping and removal of existing assertions fail. Natural-language rule text guides review; it is not an executable security policy. The deterministic controller owns enforceable gates.

## Publication and Stack Repair

Codex planning, implementation and review use the same local connection configuration as direct CLI execution. The adapter resolves `$CODEX_HOME` or `~/.codex`, parses `config.toml`, applies the selected profile, and copies only model settings plus the selected provider's endpoint, authentication, headers, query parameters and transport/retry settings. `--model` takes precedence over the configured model without changing the provider. Model API-key variables, declared provider key/header variables and proxy/certificate variables are inherited; publishing and execution-control variables are rejected. Missing providers, required keys or malformed TOML fail before model execution. Default Codex authentication also works without a config file or with an environment-provided API key.

Task-local `config.toml` and optional `auth.json` have private file permissions and live only in the owned temporary HOME, never in durable evidence. Codex loads this filtered configuration rather than using `--ignore-user-config`. User hooks, MCP servers, plugins, project trust and sandbox/approval overrides are not imported; `--ignore-rules` and the controller's explicit sandbox remain mandatory. Local cc-switch endpoints are not hardcoded: changes made to the user's active provider are loaded on subsequent executions. The service and its upstream still need to be available; configuration parity cannot guarantee upstream uptime.

Only the publisher receives normal Git/GitHub authentication. Worker environments exclude publishing tokens and SSH agent state; a task-local Codex authentication copy is removed with its temporary HOME. This is defense in depth, not an OS/container isolation guarantee: sensitive repositories still require a dedicated unprivileged runner or external sandbox.

The publisher pushes immutable task commits, creates or updates one draft PR per task, verifies the PR's SHA/base, and records publication before cleanup. Topological publication forms a linear stack. Independent coding may execute twice when integrated onto the final stack base, because earlier test evidence cannot certify a different commit. A failing predecessor causes the affected tail to be rebuilt and revalidated. Existing PR numbers are reused.

CI checks must be present and successful at the current PR SHA: `check`, `build`, `harness`, `comms-regression`, and all three `Electron E2E (...)` jobs. Pending, skipped, cancelled, missing and stale checks do not pass. Failed workflow logs feed bounded repair. All PRs remain draft until the entire current stack is accepted. There is no automatic merge or release.

## Cleanup Contract

Cleanup starts immediately after publication confirmation, before CI polling. It archives binary recovery diffs, untracked files, reports and an ownership/SHA/hash receipt outside the worktree. It stops registered process groups after verifying their PID/start identity, checks that the archive still matches current files and the published remote branch, then removes only that recorded worktree and its HOME/container. Git worktree removal updates registration; unrelated global pruning is intentionally not used. Remote branches, commits, PRs, shared caches and durable evidence remain.

Ownership mismatch, symlinked containers, unbacked changes, changed receipts, unverified orphan processes or an unpublished remote SHA prevent removal. Cleanup is retried at most three times; failures block normal completion and further allocation. Duplicate cleanup succeeds when the owned container and registration are already gone. Failure and cancellation preserve recovery patches before removal. Repair creates a fresh worktree, updates the same PR, and repeats cleanup.

## Environment and Remaining Certification

Real execution needs a compatible authenticated Codex CLI, `gh` authentication, Git push rights, pinned pnpm, Electron test dependencies and any explicitly authorized `AUTOPILOT_SANDBOX_*` values. The implementation's disposable-repository tests use controlled coding/GitHub adapters and real Git worktrees/remotes; they do not certify the real provider, GitHub permissions or every desktop platform. No feature is marked fully delivered merely because these controller tests pass. Baseline failures block actual runs and require separate reviewed repairs, not automatic weakening.

Safe restart after a hard host crash may require manual resolution when a recorded process group no longer has verifiable identity. The controller intentionally retains resources in that case. Native permission dialogs and real external accounts must use dedicated test resources. Visual screenshots remain evidence supplements, not standalone acceptance.
