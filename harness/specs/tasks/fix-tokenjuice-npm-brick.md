---
id: fix-tokenjuice-npm-brick
title: Ship tokenjuice as a bundled mirror so a missing npm can't brick the Gateway
scenario: plugin-lifecycle-management
taskType: plugin-lifecycle
intent: OpenClaw 2026.7.1 turned tokenjuice into an external official plugin whose catalog entry prefers npm, so ClawX 0.5.1's unconditional `plugins.entries.tokenjuice` write made the kernel shell out to `npm view @openclaw/tokenjuice` at startup and then refuse to report the Gateway ready on every machine without npm. Ship the plugin as a bundled mirror like the channel plugins, and make the config write conditional on the mirror actually being on disk so a missing plugin can only cost prompt optimization, never Gateway readiness.
touchedAreas:
  - harness/specs/tasks/fix-tokenjuice-npm-brick.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - harness/specs/rules/configured-plugin-install-precondition.md
  - package.json
  - pnpm-lock.yaml
  - scripts/bundle-openclaw-plugins.mjs
  - scripts/after-pack.cjs
  - electron/utils/plugin-install.ts
  - electron/gateway/config-sync.ts
  - tests/unit/session-send-remote-config-sync.test.ts
  - tests/unit/after-pack-cleanup.test.ts
expectedUserBehavior:
  - Upgrading to the fixed build on a Windows machine with no Node/npm installed starts the Gateway normally; the log shows the tokenjuice mirror being installed instead of `npm view failed` and `refusing to report the gateway ready`.
  - A user already bricked by 0.5.1 recovers by launching the fixed build — no manual config edit, no npm install, and no need to turn prompt optimization off.
  - Prompt optimization keeps compacting large exec/bash tool results, so Chat still shows shortened tool output with the same token savings as before the 2026.7.1 kernel upgrade.
  - If the mirror is genuinely unavailable, the app still starts and Chat still works; only prompt optimization is inactive.
requiredProfiles:
  - fast
requiredRules:
  - configured-plugin-install-precondition
  - plugin-mirror-removal-safety
  - active-config-guards
  - capability-owner-resolution
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/session-send-remote-config-sync.test.ts tests/unit/after-pack-cleanup.test.ts tests/unit/plugin-install.test.ts
  - pnpm run typecheck
acceptance:
  - '`@openclaw/tokenjuice` is a pinned dependency at the same version as `openclaw` itself, and both `scripts/bundle-openclaw-plugins.mjs` and `scripts/after-pack.cjs` mirror it — dev builds into `build/openclaw-plugins/tokenjuice`, packaged builds into `<Resources>/openclaw-plugins/tokenjuice`.'
  - The mirror is self-contained: it carries `openclaw.plugin.json`, `dist/`, and the vendored `node_modules/tokenjuice` that provides `dist/hosts/openclaw/extension.js`, so nothing is resolved from the registry at runtime.
  - '`scripts/after-pack.cjs` fails the build when any declared npm plugin mirror is absent from the packaged resources, instead of warning and exiting 0.'
  - '`tokenjuice` is registered in `TRUSTED_OFFICIAL_EXTENSION_PLUGINS` with `recordSource: ''path''`, so `syncTrustedOfficialPluginInstallRecord` writes a path-owned SQLite install record and links the `openclaw` peer that the plugin''s `openclaw/plugin-sdk/*` imports need.'
  - The prelaunch step materializes the mirror before touching config, and `syncPromptOptimizationPluginConfig` writes `plugins.allow` / `plugins.entries.tokenjuice` only when the plugin is resolvable from `~/.openclaw/extensions/tokenjuice` or the kernel's own `dist/extensions/`.
  - When prompt optimization is on but the plugin is not resolvable, the step removes any existing tokenjuice registration and logs a warning, leaving the config in a state the kernel's startup migration has no work to do on.
  - Turning prompt optimization off keeps clearing the registration exactly as before, so the documented "turn the toggle off" mitigation for already-bricked users still works.
docs:
  required: false
---

## Background

The 2026-08-03 user log captures the whole failure in four lines:

```
[openclaw] Reason: OpenClaw startup migrations did not complete cleanly; refusing to report the gateway ready.
- Failed to install missing configured plugin "tokenjuice" from @openclaw/tokenjuice: npm view failed: 'npm.cmd' 不是内部或外部命令
[acp-chat] loadSession failed: Error: Gateway is not running; cannot start ACP chat bridge
```

v0.4.12 ran fine for 90 minutes, the user self-updated to v0.5.1, and the Gateway never became
ready again. The trigger is npm's absence, but the cause is a config entry ClawX writes itself:
`syncPromptOptimizationPluginConfig` has always registered `tokenjuice` when the prompt
optimization setting is on, and that was harmless only because every kernel through 2026.6.x
bundled the plugin. 2026.7.1 excludes it (`"!dist/extensions/tokenjuice/**"`) and moves it to the
official *external* catalog with `install.defaultChoice: "npm"`, which makes
`installCandidate` skip the npm-free ClawHub branch entirely
(`candidate.defaultChoice !== "npm"` guards it) and go straight to `npm view`.

The kernel's own gate is generous: `installCandidate` is never reached when the plugin has a
usable install record, i.e. `Object.hasOwn(records, pluginId)` and `<installPath>/package.json`
exists. A path-owned record satisfies that, and it also fails
`isTrustedOfficialInstallRecordForCandidate` — which requires `source` to be `npm` or `clawhub` —
so the broken-official-install repair pass cannot pull the mirror back through npm either. Both
halves of ClawX's existing trusted-mirror pattern are exactly what this plugin needs.

Two independent defects had to be fixed, not one. Mirroring the plugin removes the npm call for
users who get the fixed build. Gating the config write on the install result removes the entire
failure class: any future plugin that disappears from the mirror, fails to copy on Windows, or
gets deleted from `~/.openclaw/extensions/` costs its own feature and nothing else. The packaged
mirror list in `after-pack.cjs` is separate from the dev list in `bundle-openclaw-plugins.mjs`,
and it only warned on a missing package — so the build guard that turns that warning into a
failure is part of the fix rather than a follow-up.
