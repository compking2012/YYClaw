---
id: configured-plugin-install-precondition
title: Configured Plugin Install Precondition
type: ai-coding-rule
appliesTo:
  - plugin-lifecycle-management
  - gateway-backend-communication
---

ClawX must never register a plugin in `openclaw.json` that is not already materialized on disk. A configured-but-uninstalled plugin is not a degraded feature — it is a Gateway that refuses to start.

OpenClaw's startup migration treats every id in `plugins.allow` / `plugins.entries` as something it is responsible for installing. When the id resolves to an official *external* catalog entry whose `install.defaultChoice` is `"npm"`, the kernel skips its own npm-free ClawHub path and shells out to `npm view <spec>`. On a machine with no npm — the normal case for a packaged Electron app, which carries Electron's Node but no package manager — that install fails, the failure lands in `startupMigrationWarnings`, and the config preflight throws `OpenClaw startup migrations did not complete cleanly; refusing to report the gateway ready`. The Gateway then never leaves `starting` and the entire app is unusable, including Chat.

This is not hypothetical: `tokenjuice` moved from a bundled extension to an external npm-preferring plugin in OpenClaw 2026.7.1, and ClawX 0.5.1 shipped with `syncPromptOptimizationPluginConfig` still writing the config entry unconditionally. Every user who had prompt optimization enabled and no npm on PATH lost the app on upgrade.

Therefore:

- a prelaunch step that writes `plugins.allow` / `plugins.entries` must first materialize the plugin, and must write the entry only when materialization actually succeeded — the install result decides the config, never the setting alone
- when the plugin is unavailable, the same step must remove any pre-existing entry for it rather than leaving one behind, so a user bricked by an earlier version self-heals on the next launch
- losing the plugin's feature is the acceptable failure mode; a Gateway that will not report ready is not
- mirrored official plugins must be registered in `TRUSTED_OFFICIAL_EXTENSION_PLUGINS` (`electron/utils/plugin-install.ts`) with `recordSource: 'path'`. The kernel's broken-official-install repair path calls `isTrustedOfficialInstallRecordForCandidate`, which returns false for any record whose `source` is not `npm`/`clawhub`, so a path record is what stops the repair pass from reinstalling our mirror through a package manager we do not ship
- every plugin mirror the runtime depends on must be shipped by *both* `scripts/bundle-openclaw-plugins.mjs` (dev/`build/`) and `scripts/after-pack.cjs` (packaged `<Resources>/openclaw-plugins/`). The two lists are independent; adding to one only is a defect that ships silently, so the packaged set is asserted at build time and the build fails when a declared mirror is absent
- changes to the prelaunch plugin config steps in `electron/gateway/config-sync.ts` must keep direct regression coverage for the plugin-missing branch, asserting that no registration is written
