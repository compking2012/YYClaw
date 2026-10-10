# Troubleshooting and Quality Checks

This is a development-only companion to the PRD, feature breakdown, and architecture. It records environment traps and quality gates, not public feature claims. See [DOCUMENTATION.md](DOCUMENTATION.md) for the document hierarchy.

- **Autonomous development**: `pnpm harness autopilot` requires clean committed inputs matching the remote target SHA, an authenticated compatible Codex CLI, authenticated `gh`, Git push rights and a green baseline. A failed baseline blocks coding. Publication, missing CI, unverified process ownership, stale evidence or cleanup failures leave explicit non-success run states under `artifacts/autopilot/`; inspect `run.json` before `resume --run <id>`. Resume keeps the original deadline. Never delete retained foreign/unbacked resources merely to turn a run green.

## Environment and Development

- **Autopilot with cc-switch**: Planning, coding and review inherit the local Codex model/provider connection from `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`), including authentication and proxy/certificate variables. Keep cc-switch running when the provider uses its local endpoint. `--model` changes the model only. A private filtered config/auth copy is deleted with the task HOME; user hooks, MCP servers, plugins, trust settings and publishing credentials are not inherited. Missing providers or required keys fail explicitly. Older adapters used `--ignore-user-config` and could unexpectedly select the default OpenAI provider; a timeout from that route did not mean the configured cc-switch connection was failing. Inspect configuration locally without posting credentials or complete config/auth files in logs.

- **Bundled download timeouts**: uv and agent-browser downloads retry failed requests,
  then fall back to system curl. If GitHub is unreachable, set `HTTPS_PROXY` to
  your actual HTTP proxy address before `pnpm run init`. Fetch does not accept SOCKS
  proxy URLs. Downloads continue to use official GitHub releases, not mirrors.
- **Package manager is `pnpm` only** — never `npm`/`yarn`. The exact version is pinned
  via the `packageManager` field in `package.json`.
- **Before declaring a change done**, run the relevant checks (or just run `/check`):
  `pnpm lint` · `pnpm typecheck` · `pnpm test`.
- **Renderer/Main boundary is enforced by ESLint** — never add a direct
  `window.electron.ipcRenderer.invoke(...)` call or a renderer→`localhost`/`127.0.0.1`
  `fetch(...)`. Route everything through `src/lib/host-api.ts` and
  `src/lib/host-api-client.ts`. (Full rationale in AGENTS.md.)
- **Non-mutating lint baseline**: CI and autonomous development use `pnpm run lint:check`.
  Generated `artifacts/` (including temporary worktrees), `test-results/`, and
  `playwright-report/` are excluded; repository source rules remain enforced.
  Previously unapproved blanket TypeScript suppression directives are removed, so run typecheck
  alongside lint. Explicit-`any` warnings remain advisory, not a reason to bypass errors.
- **UI changes** must add or update a Playwright E2E spec in the same change — run `/e2e`.
- **Comms-path changes** (gateway events, runtime send/receive, delivery, fallback)
  must pass `/comms-check` before finishing.
- **Doc-sync**: when behavior, flows, or interfaces change, update `README.md`,
  `README.zh-CN.md`, `README.ja-JP.md`, and `README.ru-RU.md`, plus the matching localized guides, for implemented behavior. Requirements and target-only design changes belong in root development docs and harness, not introductions.
- **Merging `upstream/main`**: this is a customized fork — preserve fork
  customizations by default and only take upstream content for a feature/fix/compat
  reason. Follow `harness/specs/rules/upstream-merge.md` before resolving conflicts.
  - **Electron dev binary arch (macOS)**: `package.json`'s `pnpm.supportedArchitectures.cpu: ["x64","arm64"]` (kept so `release:mac` can package both Intel and Apple Silicon) makes pnpm run electron's install script twice; both arches extract into the same `node_modules/electron/dist`, racing — on Apple Silicon this often leaves an x86_64 (Rosetta, slow under `pnpm dev`) or half-extracted dist. `postinstall` runs `scripts/fix-electron-dev-arch.mjs` to realign that dist to the host-native arch (idempotent, uses the `@electron/get` cache). This dist is dev-only; `release:mac` is unaffected because electron-builder downloads its own Electron per target arch. If `pnpm dev` ever errors with *"Electron failed to install correctly"*, just re-run `node scripts/fix-electron-dev-arch.mjs`.
- **Provider API payload naming**: Remote provider API payloads should only map `camelCase` fields (e.g. `p.defaultApiKey`, `p.defaultBaseUrl`). Do not add fallback checks for `snake_case` versions.
- **Persisted redaction placeholders**: If startup reports `Cannot save redacted OpenClaw credentials`, the error identifies the affected field. Retain a private backup of the damaged config and restore only matching credential values from a verified local backup, or re-enter them. Do not delete channels, replace the full current configuration, or disable validation. Invalid placeholder errors are not repaired by reconnecting.
- **Development startup integrations**: Development launches do not check release updates or register macOS login items. `dev-app-update.yml` is not required for `pnpm dev`; packaged update checks and login-item behavior remain enabled.
