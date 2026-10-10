# Implementation Harness

This is the implementation and validation layer of YYClaw, not a public feature guide. Start with the [PRD](../docs/PRODUCT.md), its [complete requirement breakdown](../docs/FEATURELIST.md), and the [technical design](../docs/ARCHITECTURE.md). See [documentation ownership](../docs/DOCUMENTATION.md).

## Structure

| Path | Role |
|------|------|
| [FEATURE-MAP.md](FEATURE-MAP.md) | Stable feature IDs mapped to existing scenarios/tasks and explicit uncovered backlog |
| specs/scenarios/ | Reusable user/runtime behavior and ownership contracts |
| specs/rules/ | Reusable safety, architecture, quality and documentation constraints |
| specs/tasks/ | Bounded implementation or repair slices: intent, paths, expected behavior, acceptance and selected validation |
| reference/ | Non-executable detailed design and compatibility evidence linked from specs |
| src/ | CLI, spec loading, boundary checks, profile selection and reports |

## From Requirement to Task

1. Select a FEATURELIST ID and one implemented defect or outstanding acceptance boundary. A PARTIAL feature generally needs multiple tasks; do not copy the entire roadmap into one executable task.
2. Use FEATURE-MAP to find the nearest scenario and existing task. Add or update a reusable scenario/rule when a new behavior or recurring constraint needs one; do not mark an uncovered feature as covered by an unrelated scenario.
3. Declare featureIds and Markdown source links, intent, touchedAreas, expectedUserBehavior, acceptance, requiredRules, requiredProfiles, requiredTests, and docs.required. featureIds is traceability metadata, not an automatically enforced CLI field. Separate prerequisites, excluded scope, and current versus planned behavior in the body.
4. For runtime/backend communication use gateway-backend-communication and its required profiles/rules. Renderer/Main/Host API/Gateway policy is not negotiable. Select E2E for visible UI behavior. Use existing task frontmatter conventions, not reference prose, as executable input.
5. Validate the actual task with pnpm harness validate --spec <task-spec> and inspect the flow with pnpm harness run --spec <task-spec> --dry-run. Run the selected checks for actual acceptance. Use --since HEAD for review against the current working tree where appropriate; --no-diff is reserved for example structural checks.
6. After implementation and evidence review, update FEATURELIST delivery status and architecture descriptions, then publish only implemented changes in all four introduction locales. Pending task/spec existence and dry-run success are not delivery evidence.

Existing historical task specs remain valid without retroactive frontmatter migration. FEATURE-MAP supplies their feature association; add explicit featureIds when creating or substantially editing a task. Reference documents may contain future design but must label it and must never be passed to harness validate/run.

## Autonomous Development

`pnpm harness autopilot plan --feature F33 --goal "A bounded development goal"` creates a frozen plan from committed docs and code. `pnpm harness autopilot run --plan <plan-file>` executes it; `run --feature <id> --goal <goal>` performs both steps. Use `status`, `resume`, or `cancel` with `--run <run-id>` for durable runs.

Prerequisites: clean committed repository, pinned pnpm, authenticated compatible Codex CLI, authenticated `gh`, Git push rights, and Electron test dependencies. Defaults: 8 tasks, 2 independent coding tasks, 3 repairs, 6 hours. Options include `--model`, `--concurrency`, `--max-repairs`, `--max-hours`, `--target`, and explicit `--allow-risk dependencies,runtime,infrastructure,release`. Risk authorization never permits weakening tests. External acceptance may receive only explicitly authorized `--sandbox-env AUTOPILOT_SANDBOX_...` values; worker/publisher credentials are not passed to tests.

Codex workers inherit the selected model/provider, endpoint, model authentication and proxy/certificate environment from the local `$CODEX_HOME` (default `~/.codex`). A cc-switch connection configured for direct `codex` is therefore also used by Autopilot; its service must remain running. `--model` overrides only the model, not the provider. Only connection settings are copied into a private temporary Codex home: user hooks, MCP servers, plugins, trust settings, sandbox overrides and publishing credentials are excluded. Invalid configuration fails explicitly rather than silently switching providers.

Each task publishes one draft PR in a topological stack and immediately removes its owned worktree, HOME, processes and temporary resources after preserving recovery/test evidence. CI repairs recreate worktrees and update the same PR. Missing acceptance, stale CI or cleanup failures block completion. No automatic merge or release. Main workspaces and shared caches are retained. Artifacts are stored under `artifacts/autopilot/<run-id>/`; inspect `run.json`, `events.jsonl`, task attempt reports and `summary.json`.

The initial committed SHA must equal the published target branch SHA. Commit and publish baseline maintenance separately before starting. The controller runs baseline lint/typecheck/unit/build/harness checks in an owned validation worktree before any coding. Existing failures block a run rather than inviting automatic gate edits. Host validation resources are serialized across runs sharing the artifact root; only isolated coding is concurrent. The resume deadline remains the original deadline, not a refreshed unlimited budget.

See [implementation and cleanup contracts](reference/autonomous-development.md). Controller tests use disposable Git repositories and controlled adapters; real account/platform certification remains required. Claude Code is reserved but not implemented.

## Baseline Validation

- pnpm harness list
- pnpm harness validate --spec <task-spec>
- pnpm harness run --spec <task-spec> --dry-run
- pnpm run harness:ci

Review both linked tests and actual results; harness structural validation does not certify the complete PRD or platform compatibility matrix.
