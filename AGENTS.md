# AGENTS.md

## Project overview

### Overview

This is a cross-platform **Electron desktop app** (React 19 + Vite + TypeScript) providing a GUI for the OpenClaw AI agent runtime. It uses pnpm as its package manager (pinned version in `package.json`'s `packageManager` field). **npm and yarn are not supported.**

### Quick reference

Standard dev commands are in `package.json` scripts and `README.md`. Key ones:

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Electron) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| Comms replay metrics | `pnpm run comms:replay` |
| Comms baseline refresh | `pnpm run comms:baseline` |
| Comms regression compare | `pnpm run comms:compare` |
| E2E tests (Playwright) | `pnpm run test:e2e` |
| README screenshots (24 images) | `pnpm run screenshots` |
| Chat performance profiles | `pnpm run perf:chat` |
| Electron Main inspector | `pnpm run profile:main` |
| Build frontend only | `pnpm run build:vite` |

## Language conventions

- **Reply to the user in Chinese (简体中文)** by default — all conversational responses,
  explanations, summaries, and feedback. Keep technical identifiers (code, file paths,
  commands, API names) as-is.
- **Write harness/config artifacts in English** — CLAUDE.md, AGENTS.md, slash-command
  and subagent prompts, hook comments, and commit messages — because English yields
  more reliable model execution. Exceptions: established Chinese domain terms that have
  no clean English equivalent, and user-facing copy that is intentionally Chinese.

## Documentation Layers

- Follow `docs/DOCUMENTATION.md`: root READMEs and localized guides introduce implemented scope only, with all four locales updated for relevant delivered changes.
- `docs/PRODUCT.md` is the PRD; `docs/FEATURELIST.md` is its complete stable-ID requirement breakdown; `docs/ARCHITECTURE.md` is the derived technical design and key implementation description. Root development docs may include explicit pending requirements/designs and do not require translation.
- Derive bounded harness tasks/scenarios/rules from FEATURELIST; maintain `harness/FEATURE-MAP.md` coverage and gaps. A task spec is not delivery evidence.
- Keep the local-only `docs/yyclaw-multi-agent-design.md` untracked and do not make tracked docs depend on it.

## Startup Rules

Before writing any code, complete these steps in order:

1. **Read this file completely.** It defines the boundaries and conventions for this project.
2. **Read `docs/ARCHITECTURE.md`** to understand the full Electron layer structure and data flow.
3. **Read `docs/PRODUCT.md`** to understand the complete feature requirements.
4. **Read `docs/TROUBLESHOOTING.md`** for the quality gates, the enforced Renderer/Main boundary, and the non-obvious environment traps.
5. **Run `pnpm run init`** to verify the project installs and initializes cleanly, then `pnpm typecheck` to verify it builds.
6. **Read `docs/FEATURELIST.md`** to see the current state of features and known issues, and to determine what to develop next.

### Non-obvious caveats

- **pnpm version**: The exact pnpm version is pinned via `packageManager` in `package.json`. Use `corepack enable && corepack prepare` to activate the correct version before installing.
- **Electron on headless Linux**: The dbus errors (`Failed to connect to the bus`) are expected and harmless in a headless/cloud environment. The app still runs fine with `$DISPLAY` set (e.g., `:1` via Xvfb/VNC).
- **Performance profiling**: `pnpm run perf:chat` writes synthetic Renderer/Main CPU profiles and versioned metrics under ignored Playwright `test-results/`. For live Renderer CDP use `CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev`; for live Main inspection use `pnpm run profile:main` and port 9229.
- **E2E parallel isolation**: Functional Electron specs run concurrently with `CLAWX_E2E_WORKERS=2` by default. Keep tests parallel-safe and test-scoped; apply `E2E_EXCLUSIVE_TAG` from `tests/e2e/parallel-policy.ts` to tests that use the real clipboard or other OS-global state, and `E2E_PERFORMANCE_TAG` to host performance profiles. Extend `tests/unit/e2e-parallel-policy.test.ts` for recognizable new global APIs.
- **`pnpm run lint` race condition**: If `pnpm run uv:download` was recently run, ESLint may fail with `ENOENT: no such file or directory, scandir '/workspace/temp_uv_extract'` because the temp directory was created and removed during download. Simply re-run lint after the download script finishes.
- **Build scripts warning**: `pnpm install` may warn about ignored build scripts for `@discordjs/opus` and `koffi`. These are optional messaging-channel dependencies and the warnings are safe to ignore.
- **macOS `.deb` toolchain**: Building the Linux `.deb` target on macOS needs GNU tar and GNU ar (`brew install gnu-tar binutils`). macOS ships only BSD `ar`/`tar`, which makes the bundled `fpm` silently produce a 96-byte empty `.deb` (just a `__.SYMDEF` ar symbol table, not a valid Debian package) while the build still exits 0. `scripts/electron-builder-env.mjs` now preflights this on `darwin` + `--linux`: it locates GNU `gtar`/`ar`, exposes them as `gtar`/`gar` in `.build-rel/deb-toolchain-bin/` (prepended to PATH so fpm's `ar_cmd` selects `["gar","-qcD"]`), and fails fast with a `brew install` hint if either is missing. AppImage is unaffected (self-contained in electron-builder).
- **`pnpm run init`**: This is a convenience script that runs `pnpm install` followed by `pnpm run uv:download`. Either run `pnpm run init` or run the two steps separately.
- **Gateway startup**: When running `pnpm dev`, the OpenClaw Gateway process starts automatically on port 18789. It takes ~10-30 seconds to become ready. Gateway readiness is not required for UI development—the app functions without it (shows "connecting" state).
- **No database**: The app uses `electron-store` (JSON files) and OS keychain. No database setup is needed.
- **AI Provider keys**: Actual AI chat requires at least one provider API key configured via Settings > AI Providers. The app is fully navigable and testable without keys.
- **Token usage history implementation**: Dashboard token usage history is not parsed from console logs. It reads OpenClaw session transcript `.jsonl` files under the local OpenClaw config directory, scans both configured agents and any runtime agent directories found on disk, and treats normal, `.deleted.jsonl`, and `.jsonl.reset.*` transcripts as valid history sources. It extracts assistant/tool usage records with `message.usage` and aggregates fields such as input/output/cache/total tokens and cost from those structured records.
- **Models page aggregation**: The 7-day/30-day filters are relative rolling windows, not calendar-month buckets. When grouped by time, the chart should keep all day buckets in the selected window; only model grouping is intentionally capped to the top entries.
- **OpenClaw Doctor in UI**: In Settings > Advanced > Developer, the app exposes both `Run Doctor` (`openclaw doctor --json`) and `Run Doctor Fix` (`openclaw doctor --fix --yes --non-interactive`) through the host-api. Renderer code should call the host route, not spawn CLI processes directly.
- **UI change validation**: Any user-visible UI change should include or update an Electron E2E spec in the same PR so the interaction is covered by Playwright.
- **README screenshots are generated**: `pnpm run screenshots` regenerates all 24 images (6 surfaces × 4 locales) via `tests/e2e/capture-readme-screenshots.spec.ts` plus `scripts/decorate-screenshots.mjs`. Re-run it when a change alters Chat, Cron, or the Models / Channels / Skills / General tabs of the System Settings modal. The capture project is gated behind `CLAWX_CAPTURE_SCREENSHOTS=1` so it never runs in `pnpm run test:e2e` — a `@screenshots` tag alone would not exclude it, because `playwright test` with no `--project` runs every configured project.
- **i18n & styling conventions**: New user-facing features must (1) route all text through `react-i18next` with full locale coverage (`en` / `zh` / `ja` / `ru` under `shared/i18n/locales/<lang>/<ns>.json`) — never hardcode display strings, and (2) use the design tokens and substitution rules documented in `src/styles/globals.css` (surfaces `bg-surface-modal` / `bg-surface-input`, selected state `bg-black/5 dark:bg-white/10`, status colours `text-X-700 dark:text-X-400`, page H1/H2 `font-serif font-normal tracking-tight`, etc.) — see the *Component conventions* block in `globals.css` for the full substitution table.
- **Renderer/Main API boundary (important)**:
  - Renderer must use `src/lib/host-api.ts` and `src/lib/host-api-client.ts` as the single entry for backend calls.
  - Do not add new direct `window.electron.ipcRenderer.invoke(...)` calls in pages/components; expose them through host-api/host-api-client instead.
  - Do not call Gateway HTTP endpoints directly from renderer (`fetch('http://127.0.0.1:18789/...')` etc.). Use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`) to avoid CORS/env drift.
  - Transport policy is Main-owned and fixed as `WS -> HTTP -> IPC fallback`; renderer should not implement protocol switching UI/business logic.
- **Comms-change checklist**: If your change touches communication paths (gateway events, runtime send/receive, delivery, or fallback), run `pnpm run comms:replay` and `pnpm run comms:compare` before pushing.
- **Doc sync rule**: After any functional or architecture change, review `README.md`, `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md` for required updates, plus the matching deep-dive docs under `docs/<locale>/` (`features.md` / `architecture.md` / `development.md` / `proxy-settings.md`); if behavior/flows/interfaces changed, update docs in the same PR/commit. Keep the four READMEs structurally parallel — same heading set, per-locale screenshot paths.
- **Spec-driven harness rule**: AI Coding tasks that touch backend communication must start from a task spec under `harness/specs/tasks/` and reference `gateway-backend-communication` when the change involves renderer/Main/host-api/host-api-client/Gateway/OpenClaw runtime paths. Run `pnpm harness validate --spec <task-spec>` before implementation review, and `pnpm harness run --spec <task-spec>` or `--dry-run` when checking the selected validation flow.
- **Spec/rule growth rule**: When adding a new feature, user-visible OpenClaw scenario, or recurring AI Coding constraint, add or update the relevant harness scenario spec and rule spec in the same PR so future AI work can validate the behavior instead of relying on tribal knowledge.
- **Harness CI/local parity**: Run `pnpm run harness:ci` to exercise the same baseline harness checks used by GitHub Actions. Real task specs should be validated without `--no-diff`; `--no-diff` is only for structural checks of checked-in examples.
- **Harness reference docs**: Keep durable, non-executable architecture and compatibility details under `harness/reference/`. Link them from the relevant scenario, rule, and task specs, but do not pass reference documents to `harness validate` or `harness run`.
