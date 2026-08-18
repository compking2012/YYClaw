---
id: plugin-mirror-removal-safety
title: Plugin Mirror Removal Safety
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

ClawX links the bundled OpenClaw runtime into every materialized plugin mirror: `~/.openclaw/extensions/<plugin>/node_modules/openclaw` is a Windows junction (or POSIX directory symlink) pointing at `<install>/resources/openclaw`. Deleting such a mirror with `fs.rmSync(dir, { recursive: true })` destroys the runtime on Windows — `unlink` answers `EPERM` on the junction, Node's `fixWinEPERMSync` recovery re-stats it with a dereferencing `statSync`, and the walk continues into the link target. The app then fails every launch with `OpenClaw package not found at: ...\resources\openclaw` until it is reinstalled.

Therefore:

- never call `fs.rmSync` / `fs.rm` with `recursive: true` on a path that can contain a link out of the tree — this covers `~/.openclaw/extensions/*`, `~/.openclaw/skills/*`, `~/.openclaw/workspace/skills/*`, and `~/.openclaw/plugin-runtime-deps/*`
- remove plugin mirrors through `removePluginMirrorDir` (`electron/utils/plugin-install.ts`), which drops the `openclaw` peer link first and then walks the tree with `safeRmSync`
- remove other link-bearing trees, and single links, with `safeRmSync` (`electron/utils/safe-fs.ts`). It never traverses a link, fails closed when a directory's realpath cannot be resolved or escapes the deletion root, and refuses to descend into an already-visited realpath — so a junction that `lstat` mis-reports as a plain directory is caught whether it points outside the tree or back into it (`openclaw doctor --fix` creates `<pkg>/node_modules/<pkg>` self-references, which are cycles)
- recursive copy helpers must inspect entries with `lstat` and skip links rather than dereferencing them, so a peer junction is never cloned into the mirror
- a missing bundled runtime is a fatal startup failure: `hasMissingRuntimeFailureSignal` (`electron/gateway/startup-recovery.ts`) must keep disabling Gateway auto-reconnect so the failure is reported once instead of looping
- changes to `electron/utils/safe-fs.ts`, `electron/utils/plugin-install.ts`, `electron/gateway/config-sync.ts`, or `electron/gateway/skills-symlink-cleanup.ts` that touch removal or copy paths must keep direct regression coverage proving the link target survives
