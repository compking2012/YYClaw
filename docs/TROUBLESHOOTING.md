- **Package manager is `pnpm` only** — never `npm`/`yarn`. The exact version is pinned
  via the `packageManager` field in `package.json`.
- **Before declaring a change done**, run the relevant checks (or just run `/check`):
  `pnpm lint` · `pnpm typecheck` · `pnpm test`.
- **Renderer/Main boundary is enforced by ESLint** — never add a direct
  `window.electron.ipcRenderer.invoke(...)` call or a renderer→`localhost`/`127.0.0.1`
  `fetch(...)`. Route everything through `src/lib/host-api.ts` and
  `src/lib/api-client.ts`. (Full rationale in AGENTS.md.)
- **UI changes** must add or update a Playwright E2E spec in the same change — run `/e2e`.
- **Comms-path changes** (gateway events, runtime send/receive, delivery, fallback)
  must pass `/comms-check` before finishing.
- **Doc-sync**: when behavior, flows, or interfaces change, update `README.md`,
  `README.zh-CN.md`, and `README.ja-JP.md` in the same change.
- **Merging `upstream/main`**: this is a customized fork — preserve fork
  customizations by default and only take upstream content for a feature/fix/compat
  reason. Follow `harness/specs/rules/upstream-merge.md` before resolving conflicts.
  - **Electron dev binary arch (macOS)**: `package.json`'s `pnpm.supportedArchitectures.cpu: ["x64","arm64"]` (kept so `release:mac` can package both Intel and Apple Silicon) makes pnpm run electron's install script twice; both arches extract into the same `node_modules/electron/dist`, racing — on Apple Silicon this often leaves an x86_64 (Rosetta, slow under `pnpm dev`) or half-extracted dist. `postinstall` runs `scripts/fix-electron-dev-arch.mjs` to realign that dist to the host-native arch (idempotent, uses the `@electron/get` cache). This dist is dev-only; `release:mac` is unaffected because electron-builder downloads its own Electron per target arch. If `pnpm dev` ever errors with *"Electron failed to install correctly"*, just re-run `node scripts/fix-electron-dev-arch.mjs`.
- **Provider API payload naming**: Remote provider API payloads should only map `camelCase` fields (e.g. `p.defaultApiKey`, `p.defaultBaseUrl`). Do not add fallback checks for `snake_case` versions.

