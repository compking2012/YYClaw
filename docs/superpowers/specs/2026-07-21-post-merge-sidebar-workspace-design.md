# Post-Merge Sidebar and Workspace Repair Design

## Goal

Repair the three regressions introduced while merging `upstream/main` into the local branch:

1. Sidebar entries must render their intended pages instead of a blank outlet.
2. A new ACP chat must work when the app-managed default workspace does not exist yet.
3. Sidebar workspace/session text must use the same typography token as navigation items.

## Root Causes

- `Sidebar.tsx` links to `/models`, `/channels`, `/skills`, `/image-generation`, `/dreams`, and `/settings`, while `App.tsx` only registers Chat, Agents, Cron, Workflows, and Office routes.
- ACP access grants canonicalize both paths with `realpath`. The default `~/.openclaw/workspace` is a valid app-managed default but is not guaranteed to exist before the first locally-created session.
- Navigation labels use `sidebar-nav-text`, while workspace/session rows use `text-meta`, allowing their sizes to drift.

## Design

Register every core Sidebar destination in `App.tsx` using the page components already present in the merged tree. Keep the existing dev-mode guards for Image Generation, Dreams, and Workflows.

Extend the Main-owned ACP access preparation API with an explicit `createWorkspaceRoot` option. `AcpChatService` may enable it only for a locally-created session whose workspace root and execution cwd are both the managed default workspace. The registry still canonicalizes the resulting directory and still rejects missing custom workspaces, files, and cwd values outside the root.

Apply `sidebar-nav-text` to workspace group and session buttons so the same named typography token controls all Sidebar primary text.

## Validation

- Electron E2E navigation coverage clicks the direct Sidebar entries and asserts each page and URL.
- ACP access-registry unit coverage proves opt-in creation and preserves strict rejection without the option.
- Sidebar unit coverage asserts that workspace/session buttons share the navigation typography class.
- Run focused tests, typecheck, build, harness validation, and communication regression checks when dependencies are available.

## Scope

Do not resolve unrelated merge conflicts or change renderer/Main transport ownership. Do not create arbitrary user-supplied workspace paths.
