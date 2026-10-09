# Architecture -- YYClaw Desktop Client

## System Overview

**YYClaw** is a cross-platform Electron desktop application that provides a
graphical interface for the **OpenClaw** AI agent runtime. It is built with
Electron 40+, React 19, TypeScript, Vite, Tailwind CSS + shadcn/ui, and Zustand.

The application turns a command-line AI orchestration runtime into an accessible
desktop experience: intelligent chat with multiple agents, voice interaction,
multi-channel messaging, cron-based automation, a deterministic workflow engine,
a local-first skill system, secure provider integration, and runtime
observability.

Architecturally, YYClaw is a **dual-process Electron app fronting a
supervised OpenClaw Gateway subprocess**. The renderer never talks to the
network or filesystem directly; instead, all backend access flows through a
single unified client abstraction whose transport policy is owned by the Electron
main process. This document describes the layers, the communication paths, the
data flow, and the runtime contracts that keep those boundaries enforceable.

## Target Architecture: Unified Local–Cloud Workbench

The [product PRD](PRODUCT.md#product-vision-and-scope) extends the desktop
foundation toward a shared Agent runtime across desktop, mobile/tablet consoles,
and Headless Linux servers. This section defines **target requirements**, not
implemented remote-host or synchronization contracts. The remaining sections
describe the existing Electron architecture and its enforced boundaries.

- **Platform adapters:** Desktop exposes authorized local execution capabilities;
  mobile exposes chat, capture/upload, monitoring, dispatch, and notifications
  without unrestricted Shell/system access; servers expose persistent execution,
  Cron, channel monitoring, and user/workspace isolation without a GUI.
- **Shared runtime and schemas:** Agent configurations, memory schemas, skill
  libraries, workflow definitions, task identities, events, and snapshots must be
  compatible across eligible nodes. Synchronization covers only authorized data;
  local private memories and system credentials are excluded.
- **Placement policy:** Privacy and required local capabilities are hard
  constraints. Authorized scheduled/monitoring/batch tasks estimated above 30
  minutes prefer cloud hosts. Lightweight inference/OCR prefers local compute;
  complex reasoning and generation may prefer cloud inference when allowed.
  Execution location and model-provider location are separate decisions: a local
  Agent calling a cloud model is not a device-only privacy boundary.
- **Checkpoint migration:** Event logs plus state snapshots support transfer at
  safe checkpoints, compatible runtime/capability validation, and single-owner
  execution. Recovery must account for external side effects without duplicating
  them. Planned sleep/shutdown can attempt eligible handoffs; sudden device loss
  requires recovery from the last durable checkpoint. Sensitive/local-bound tasks
  never migrate merely to satisfy a duration preference.
- **Data isolation:** Sensitive files, private memories, and system credentials
  remain local. Non-sensitive task configuration, logs, and workspace data may
  synchronize with explicit authorization and scoped file access. Snapshots and
  logs require the same classification controls as source data. A cloud host has
  no default access to a desktop's files or permissions.
- **Multimodal pipeline:** Screen/image perception, voice, PDF/Office parsing,
  and video frames feed typed workflow inputs; text, charts, images, speech, and
  video scripts are output artifacts. Local OCR/transcription and cloud
  understanding/generation share the placement/privacy policy.
- **Deterministic orchestration:** XState defines control flow, explicit reasoning
  nodes invoke models, and retries, approvals, recovery, and audit are engine
  responsibilities. Concurrent Agents retain separate models, skills, channels,
  permissions, and physically isolated workspaces.

Future remote-host support must preserve the Renderer → Host API → Main-owned
backend boundary; it must not add renderer-side Gateway connections or protocol
switching. Self-hosting the catalog/marketplace through `farmApiBaseUrl` is not a
cloud Agent deployment mechanism. Protocol design and implementation remain
separate tasks governed by the communication harness.

## Layer Diagram

```
+---------------------------------------------------------------------+
|                      Renderer Process (React 19)                    |
|  main.tsx -> HashRouter -> App.tsx -> MainLayout (TitleBar/Sidebar) |
|    Pages:   Chat, Agents, Cron, Workflows, Setup                    |
|    Modals:  SystemSettingsModal (System/Models/Channels/Skills/     |
|             Memory tabs), PersonaSettingsModal                      |
|    Sidebar: Chat workspace-files panel (ArtifactPanel browser tab)  |
|    State:   Zustand stores (settings/gateway/chat/providers/...)    |
|    Render:  react-markdown + remark-gfm + remark-math + KaTeX       |
+---------------------------------------------------------------------+
        |  src/lib/host-api.ts   (REST: hostApiFetch)
        |  src/lib/host-api-client.ts (transport: invokeHost)
        |  src/lib/host-events.ts(realtime: subscribeHostEvent)
        v
+---------------------------------------------------------------------+
|                          Preload (contextBridge)                    |
|  window.electron = { ipcRenderer.invoke/on/off (whitelisted),       |
|                      openExternal, getPathForFile, platform, isDev }|
+---------------------------------------------------------------------+
        |  ipcRenderer.invoke(channel, ...args)
        v
+---------------------------------------------------------------------+
|                       Electron Main Process                         |
|  main/index.ts        -> bootstrap, window, lifecycle, single-inst. |
|  main/ipc-handlers.ts -> IPC channel registration (all namespaces)  |
|  api/server.ts        -> Host API HTTP server (127.0.0.1:13210)     |
|  gateway/manager.ts   -> OpenClaw Gateway supervision + WS RPC      |
|  services/*           -> providers, secrets, admin-console          |
|  workflow/*           -> XState deterministic workflow engine       |
|  extensions/*         -> builtin/loadable host-api + marketplace    |
+---------------------------------------------------------------------+
        |  WebSocket JSON-RPC (Main-owned)        |  Local HTTP proxy
        v                                         v
+---------------------------------------------------------------------+
|                  OpenClaw Gateway (127.0.0.1:18789)                 |
|  Electron UtilityProcess child running the embedded OpenClaw core   |
|  AI agent runtime | channel management | skill/plugin execution     |
|  provider abstraction | sessions (.jsonl transcripts) | voice RPCs  |
+---------------------------------------------------------------------+
```

## Process Model

A single YYClaw "app" appears as **multiple OS processes** -- this is
expected for Electron:

- **Main process** -- owns windows, application lifecycle, IPC, the Host API HTTP
  server, the Gateway supervisor, system integration (tray, keychain,
  notifications, auto-update), and all filesystem access.
- **Renderer process** -- the React UI. Runs with `contextIsolation: true` and
  reaches the backend only through the preload bridge. Never imports Node.js
  modules.
- **Gateway process** -- the embedded OpenClaw runtime, launched by Main as an
  `Electron.UtilityProcess` child and supervised over a local WebSocket.
- **Helper processes** -- Electron zygote/GPU/utility processes plus an optional
  uv-managed Python toolchain warmed up for skills.

**Single-instance protection** combines Electron's `requestSingleInstanceLock()`
with a file-based lock (`userData/clawx.instance.lock`) so that environments with
unstable desktop IPC still cannot launch a duplicate app or fight over the
Gateway listener. The Gateway listener on `127.0.0.1:18789` must remain
single-owner.

**Quit semantics**: closing the window button hides the app to the tray rather
than quitting. A real quit is an asynchronous, ordered teardown (see
[Application Lifecycle](#application-lifecycle)).

## Renderer Communication Model

The renderer has exactly two ways to reach the backend, and **both are mediated by
the main process**. The renderer never opens a socket to the Gateway and never
issues a cross-origin `fetch` -- both are forbidden by ESLint and by the runtime
contract.

| Tier | Renderer entry | Main mechanism | Transport | Purpose |
|------|----------------|----------------|-----------|---------|
| **1. Typed host API** | `hostApi.*` / `hostApiFetch(path)` -> `invokeHost(module, action)` | `ipcMain.handle('host:invoke')` typed dispatcher | Direct IPC via the preload `hostInvoke` bridge | Everything request/response: chat, settings, providers, agents, channels, skills, cron, workflow, voice, window, update, files, Gateway lifecycle/RPC, OAuth, uv |
| **2. Realtime** | `subscribeHostEvent(name)` | IPC push (`webContents.send`) | IPC event | Live Gateway status, chat runtime events, workflow progress, OAuth, channel status |

**Why this shape:**

- **Single entry for the frontend.** Everything goes through
  `src/lib/host-api.ts` (typed facade) and `src/lib/host-api-client.ts`
  (transport), so protocol details stay hidden behind a stable, contract-typed
  interface.
- **Main-owned transport strategy.** The `WS -> HTTP -> IPC` policy governs how
  **Main** reaches the Gateway, not how the renderer reaches Main. The renderer's
  own path is IPC-only, which guarantees reliability and CORS-safety.
- **CORS-safe by design.** Any local HTTP access is performed by Main, so the
  renderer never triggers cross-origin failures across dev/prod.
- **Bearer-authenticated Host API.** Where the Host API server is used, it mints a
  random session-scoped token, and Main injects `Authorization: Bearer ...` and
  requires `application/json` on mutations (CSRF mitigation).

## Electron Layers

### Main Process (`electron/main/`)

**Entry: `electron/main/index.ts`.** Bootstrap order is deliberately
UI-first so the window appears without waiting on the Gateway:

1. Pre-`ready`: disable GPU as needed, set Linux desktop env, apply E2E
   overrides (temporary `userData`, remote debugging).
2. Acquire the single-instance lock (Electron lock + file lock).
3. Construct global singletons: `GatewayManager`, `ClawHubService`,
   `HostEventBus`.
4. On `app.ready` -> `initialize()`:
   - logger, application menu, proxy, launch-at-startup, Admin Console, telemetry
   - **create the main window early** (UI does not block on the Gateway)
   - register IPC handlers, instantiate the workflow engine, start the Host API
     server
   - system tray, Control-UI CSP header rewrite, microphone permission
   - initialize the extension registry
   - bridge Gateway events into the `HostEventBus`
   - if `gatewayAutoStart`: sync provider auth, then `gatewayManager.start()`
   - background tasks: bundled skills install, CLI auto-install, workspace
     bootstrap

Other main modules: `window.ts` (persisted window bounds via `electron-store`,
multi-monitor visibility checks), `tray.ts`, `menu.ts`, `updater.ts`
(electron-updater), `proxy.ts`, `launch-at-startup.ts`, `process-instance-lock.ts`,
`main-window-focus.ts`, `app-state.ts` / `quit-lifecycle.ts` / `signal-quit.ts`,
and `file-preview-ipc.ts`.

### Preload (`electron/preload/index.ts`)

The preload script is the **only** bridge between main and renderer. It uses
`contextBridge.exposeInMainWorld('electron', ...)` to expose a narrow,
**whitelisted** surface:

```typescript
window.electron = {
  ipcRenderer: {
    invoke,   // strict channel allowlist; unknown channels throw
    on, once, off, // event allowlist + ext:* extension channels
  },
  openExternal,
  getPathForFile,
  platform,
  isDev,
}
```

Renderer code does not consume this object directly. Project convention requires
all calls to flow through `src/lib/host-api.ts` (`hostApi` / `hostApiFetch`) and
`src/lib/host-api-client.ts` (`invokeHost`); ESLint blocks direct
`ipcRenderer.invoke` and renderer->localhost `fetch`.

### Renderer (`electron/`'s counterpart in `src/`)

React 19 application bundled by Vite, mounted from `src/main.tsx` (HashRouter)
into `src/App.tsx`.

- `App.tsx` -- top-level routing, global initialization (settings, gateway,
  providers, extensions, theme, i18n), setup-completion redirect, global
  `ErrorBoundary`, `Toaster`, and `PortConflictDialog`.
- `components/layout/MainLayout.tsx` -- shell composed of `TitleBar`, `Sidebar`,
  and a routed `<Outlet>`.
- `components/layout/Sidebar.tsx` -- primary navigation, New Chat, time-bucketed
  session list, and Settings entry. Dev-mode-only entries (Workflows, Image
  Generation) appear conditionally.
- `components/layout/TitleBar.tsx` -- macOS drag region / Windows custom title bar
  with min/max/close routed through `window:*` IPC.

Pages live in `src/pages/` (see [Renderer Pages](#renderer-pages-srcpages)),
reusable UI in `src/components/`, and frontend domain logic in `src/lib/`.

## Frontend API Boundary (`src/lib/`)

### `host-api.ts` -- typed host facade

`hostApi` is the single entry the renderer uses for backend calls. It is a typed
facade over the `shared/host-api/contract.ts` module/action registry, and every
method delegates to `invokeHost` (see below). Pages and components import
`hostApi` from `@/lib/host-api`; they never call IPC directly.

`hostApiFetch<T>(path, init?)` remains for legacy `/api/*`-shaped business calls.
It normalizes headers and routes the request through the typed
`invokeHost('legacy', 'fetch', ...)` action, so the request executes inside the
main process and CORS never applies in either dev or prod. Non-2xx responses throw;
`204`/empty bodies resolve to `undefined`.

### `host-api-client.ts` -- typed IPC transport

`invokeHost(module, action, ...payload)` is the renderer's only transport call. It
builds a `TypedHostRequest` with a `crypto.randomUUID()` id and dispatches it over
the preload bridge `window.clawx.hostInvoke`, which is
`ipcRenderer.invoke('host:invoke', request)`. If the bridge is unavailable it
throws immediately — there is no localhost HTTP fallback in the renderer.

> **Transport policy is not a renderer concern.** The `WS -> HTTP -> IPC` policy,
> the Gateway WebSocket, backoff, and reconnect all live in the main process (see
> [Gateway Management](#gateway-management-electrongateway), notably
> `ws-client.ts`, `connection-monitor.ts`, and `restart-governor.ts`). The renderer
> implements no protocol switching. The
> `localStorage['clawx:gateway-ws-diagnostic']` flag
> (`src/lib/gateway-ws-diagnostic.ts`) only toggles diagnostic tracing exposed in
> **Settings → Advanced → Developer**.

### `error-model.ts` -- unified error model

`AppErrorCode` covers `AUTH_INVALID`, `TIMEOUT`, `RATE_LIMIT`, `PERMISSION`,
`CHANNEL_UNAVAILABLE`, `NETWORK`, `CONFIG`, `GATEWAY`, `UNKNOWN`. Backend codes
map through `mapBackendErrorCode`, message heuristics through `classifyMessage`,
and every catch path calls `normalizeAppError(err, details)` to attach
`transport`/`channel`/`source` context. `toUserMessage()` renders i18n-friendly
copy per code.

### `host-events.ts` -- realtime subscription

`subscribeHostEvent(name, handler)` receives realtime updates over IPC push,
mapping channels such as `chat:runtime-event`, `gateway:status`, and
`workflow:progress`. IPC push is the only mechanism — there is no SSE or
EventSource fallback in the renderer.

## State Management (`src/stores/`)

All global state uses **Zustand**. Stores call the backend exclusively through
`hostApi` / `hostApiFetch` and receive realtime updates via
`subscribeHostEvent`.

| Store | Manages | Backend access |
|-------|---------|----------------|
| `useSettingsStore` | theme, language, gateway/proxy/update/voice toggles, setup completion, dev mode | `persist` + `/api/settings` |
| `useGatewayStore` | Gateway lifecycle, health, RPC wrapper, runtime-event dispatch into chat | `/api/gateway/*` + `gateway:rpc` + host events |
| `useChatStore` (+ `stores/chat/*`) | messages, sessions, streaming, runtime runs, workflow cards, history | `/api/chat/*`, `/api/sessions/*` + events |
| `useProviderStore` | provider accounts, API-key status, vendor list | `/api/providers` + `lib/provider-accounts` |
| `useAgentsStore` | agents, default models, channel binding, per-agent skills | `/api/agents/*` |
| `useChannelsStore` | channel connection status, QR/OAuth | `/api/channels/*` + events |
| `useSkillsStore` | local/Gateway skills, enable/disable, install | `/api/skills/*` + IPC |
| `useSkillsMarketplaceStore` | remote marketplace search | `/api/skills/marketplace` |
| `useCronStore` | cron job CRUD, trigger | `/api/cron/jobs` |
| `useWorkflowStore` | workflow definitions & run records | `lib/workflow-api` + `workflow:progress` |
| `useUpdateStore` | update check/download/install | `update:*` IPC |
| `useArtifactPanel` | chat artifact-panel UI (tab/width/focused file) | UI-only (`persist`) |

The chat store is decomposed under `stores/chat/` into session, history,
runtime-event, runtime-send, runtime-graph, prompt-optimization, and helper
modules.

## Renderer Pages (`src/pages/`)

Routes are defined in `src/App.tsx` using `react-router-dom` v6 under a
`HashRouter`.

| Route | Page | Description |
|-------|------|-------------|
| `/setup/*` | `Setup` | First-launch wizard: language, runtime detection, default skill install, verification |
| `/` | `Chat` | Main chat: message stream, composer (@agent / `/skill` / model picker), artifact panel, inline workflow cards, voice/TTS, workspace-files sidebar |
| `/agents` | `Agents` | Multi-agent management: per-agent model, skill allowlist, channel binding, persona settings modal |
| `/cron` | `Cron` | Cron job CRUD, trigger, run history, external delivery config |
| `/workflows` | `Workflows` | Deterministic workflow engine UI (dev-mode gated) |
| `/image-generation` | `ImageGeneration` | Dedicated image-generation endpoint settings (dev-mode gated) |

The former `Models`, `Channels`, `Skills`, `Dreams`, `Settings`, and
`Workspace` pages no longer have top-level routes. `Models` / `Channels` /
`Skills` / `Dreams` (now "Memory") / `Settings` (now "System") are tabs inside
the `SystemSettingsModal` (opened from the sidebar footer); per-agent persona
files live in `PersonaSettingsModal` (opened from each `AgentCard`); and agent
workspace files are browsed in the Chat page's right-side `ArtifactPanel`
(browser tab, writable). The standalone `/workspace` route was removed.
Extensions may inject additional routes via the renderer extension registry.

## Components (`src/components/`)

- **Layout** -- `MainLayout`, `Sidebar`, `TitleBar` (the app shell).
- **UI primitives** (`components/ui/`) -- shadcn/ui-style `button`, `input`,
  `dialog`, `sheet`, `tabs`, `select`, `combobox`, `tooltip`, `confirm-dialog`,
  etc.
- **Chat & Markdown** -- `AssistantMarkdown` (react-markdown + remark-gfm +
  remark-math + rehype-katex), `ChatInput` (attachment staging, @agent, `/skill`
  triggers, model picker, dictation/Talk), `ExecutionGraphCard`,
  `WorkflowInlineCard`, `WorkflowRunPanel`.
- **File preview** (`components/file-preview/`) -- `ArtifactPanel`,
  `MonacoViewer`/`MonacoDiffViewer`, `PdfViewer`, `HtmlPreview`, `ImageViewer`,
  `SheetViewer`, `MarkdownPreview`, `WorkspaceBrowserBody`.
- **Skills** (`components/skills/`) -- skill picker dialog/search,
  `SkillAllowlistPicker`, `AgentSelectorDialog`, `DynamicRenderer` for
  skill-provided UI.
- **Settings** (`components/settings/`) -- `ProvidersSettings`, `UpdateSettings`,
  `ImageGenerationSettings`, `KindParamsEditor`.
- **Common** -- `ErrorBoundary`, `LoadingSpinner`, `ForceUpdateModal`,
  `StatusBadge`; plus `channels/ChannelConfigModal` and
  `gateway/PortConflictDialog`.

## Main-Side API Router (`electron/api/`)

The Host API is a local HTTP server that turns the renderer's REST calls into
Gateway RPCs and local operations.

- **`server.ts`** binds `127.0.0.1:13210` (`CLAWX_HOST_API`, env-overridable),
  mints a per-session Bearer token, and applies middleware: CORS allowlist
  (renderer dev origin + Gateway origin), Bearer auth, and
  `application/json`-required mutations. WebSocket upgrades are rejected; SSE uses
  a long-lived HTTP connection.
- **`route-utils.ts`** -- `parseJsonBody`, `sendJson`, `setCorsHeaders`,
  `requireJsonContentType`.
- **`context.ts`** -- `HostApiContext` carries `gatewayManager`,
  `clawHubService`, `eventBus`, `mainWindow`, `workflowEngine`.
- **`event-bus.ts`** -- the SSE `HostEventBus`; `emit(name, payload)` writes
  `event:`/`data:` frames and pushes a current `gateway:status` snapshot on
  connect.

Route modules under `electron/api/routes/`:

| Route file | Paths / responsibility |
|------------|------------------------|
| `app.ts` | `/api/events` (SSE), `/api/app/openclaw-doctor`, session maintenance |
| `gateway.ts` | `/api/gateway/*`, `/api/chat/*`, `/api/app/gateway-info` |
| `settings.ts` | `/api/settings` get/put/reset |
| `providers.ts` | `/api/providers`, `/api/provider-accounts`, OAuth |
| `agents.ts` | `/api/agents` CRUD, defaults/skills/models |
| `channels.ts` | `/api/channels/*` (config, Feishu, WhatsApp/WeChat QR) |
| `skills.ts` | `/api/skills/*`, `/api/clawhub/*`, marketplace |
| `files.ts` | `/api/files/stage-*`, thumbnails, save-image |
| `sessions.ts` | transcripts, delete, summaries |
| `cron.ts` | `/api/cron/jobs`, toggle, trigger |
| `workspace.ts` | OpenClaw workspace tree/file CRUD |
| `workflow.ts` | `/api/workflow/list|start|start-dynamic|resume|abort|status` |
| `voice.ts` | TTS/STT/realtime config & calls |
| `diagnostics.ts` | `/api/diagnostics/gateway-snapshot` |
| `admin-console.ts` | remote session / shared-workspace sync |
| `prompt-optimization.ts` | prompt optimizer run records |
| `logs.ts` / `usage.ts` / `media.ts` | logs, token history, image generation |

Core route handlers are concatenated with handlers contributed by the extension
registry.

## Gateway Management (`electron/gateway/`)

`GatewayManager` (`manager.ts`) is the heart of the runtime. It is an
`EventEmitter` emitting `status`, `error`, `exit`, `notification`,
`chat:message`, `chat:runtime-event`, `channel:status`, and `port-conflict`.

- **Child process** -- launched as an `Electron.UtilityProcess`
  (`process-launcher.ts`) on `PORTS.OPENCLAW_GATEWAY = 18789`.
- **WebSocket client** (`ws-client.ts`) -- connects to
  `ws://127.0.0.1:{port}/ws` and completes a device-identity challenge
  (`connect.challenge` -> signed connect frame).
- **RPC** -- OpenClaw protocol frames `{ type: "req", id, method, params }` with a
  `critical | high | normal` priority queue; `sessions.list` and admin
  apply-sync are mutually coordinated.
- **Startup orchestration** (`startup-orchestrator.ts`) -- find an existing
  Gateway to reuse or detect a port conflict; otherwise wait for the port,
  launch, and `waitForGatewayReady()` (probe until `connect.challenge`), then
  connect. On failure it runs `openclaw doctor` repair and retries (up to 3
  spawns). A `PortConflictError` surfaces to the UI via
  `gateway:resolve-conflict`.
- **Supervision** (`supervisor.ts`) -- locate/terminate owned Gateway processes
  (Windows `taskkill /T`), force-kill, wait for the port to free, warm up the
  uv-managed Python, and on macOS unload any conflicting launchd service.
- **Connection monitor** (`connection-monitor.ts`) -- 30s ping interval, 10s
  timeout; three consecutive misses trigger reconnect; an independent health
  check runs every ~30s (`GATEWAY_CONFIG.HEALTH_CHECK_INTERVAL`).
- **Config sync** (`config-sync.ts`, `reload-policy.ts`) -- YYClaw settings are
  synced into OpenClaw config/env before start. Ordinary `openclaw.json` writes
  rely on OpenClaw's native watcher and reload planner; model changes additionally
  poll `agents.list` until the live runtime snapshot converges. Explicit process
  restarts are reserved for restart-only server/plugin/destructive operations.

The main process is the **only** holder of the Gateway WebSocket; the renderer
reaches the Gateway through `gateway:rpc` (IPC) or `gateway:httpProxy` (HTTP
proxy). The Control UI is embeddable via `<webview>` because Main strips
`X-Frame-Options` and relaxes `frame-ancestors` CSP for `127.0.0.1:18789`.

## Services (`electron/services/`)

- **`providers/`** -- AI provider account layer. `provider-service.ts` is the
  facade (`listVendors`, `listAccounts`, alignment with OpenClaw active keys);
  `provider-store.ts` persists accounts in `electron-store`;
  `provider-runtime-sync.ts` mirrors changes into OpenClaw runtime config;
  `provider-validation.ts` validates API keys (with a lightweight
  `/chat/completions` or `/responses` probe fallback when `/models` is rejected
  for non-auth reasons).
- **`secrets/secret-store.ts`** -- `ElectronStoreSecretStore` stores provider
  secrets and legacy API keys. Per the project's storage note, provider configs
  are currently written as structured plain-text JSON on disk (to avoid
  conflicts with OpenClaw's config-health mechanism), while reading historical
  encrypted configs (`CLAWX_ENCRYPTED_v1:`) remains supported; select flows use
  `safeStorage` encryption.
- **`admin-console/`** -- optional centralized management: a Centrifuge
  WebSocket client, remote-sync appliers that apply remote config changes to the
  local Gateway (agents/models/providers + restart), protocol
  commands/handlers/topics, and a queue that serializes apply-sync against
  Gateway RPC.

## Workflow Engine (`electron/workflow/`)

A **generic deterministic workflow kernel** built on XState v5.

- `index.ts` -- Electron bootstrap: a `SnapshotStore` rooted at
  `userData/workflows/` plus a `GatewayBackedAdapter`, wired as a singleton.
- `engine.ts` -- XState actor lifecycle: `register` / `start` / `resume` /
  `abort` / `rehydrate`, emitting `workflow:progress`.
- `snapshot-store.ts` -- one versioned JSON file per run; `listActive()` enables
  crash-resume rehydration on startup.
- `definitions/` -- built-in workflows (e.g. `demo-report.ts`).
- `dynamic/` -- LLM-generated dynamic steps (`generate.ts`) compiled into an
  XState machine (`compile.ts`).
- `adapter/` -- `openclaw-adapter.ts` abstraction (`callTool`, `runModel`,
  `runAgent`), with `headless-adapter.ts` (no-Gateway deterministic + model
  steps) and `gateway-adapter.ts` (`runAgent` via `chat.send` +
  `agent-reply-wait.ts`).

Control flow is 100% deterministic; only nodes explicitly marked *model*/*agent*
carry non-determinism, constrained by `temperature=0` + zod validation + bounded
retries. Each run produces a per-node trace labeling steps deterministic vs.
model. Progress propagates to both the `HostEventBus` and the IPC
`workflow:progress` channel; the Host API exposes `/api/workflow/*`.

## Extensions (`electron/extensions/`)

A pluggable layer that augments the Host API and the skill marketplace.

- `registry.ts` -- registration, initialize/teardown, and aggregation of route
  handlers and marketplace providers.
- `loader.ts` -- reads `clawx-extensions.json` (packaged under `resourcesPath`);
  otherwise loads all builtins.
- `builtin/` -- `clawhub-marketplace.ts` (community edition disables public
  ClawHub), `company-hub-marketplace.ts` (enterprise hub install),
  `diagnostics.ts` (diagnostic Host API routes).

Extension types include `HostApiRouteExtension` and
`MarketplaceProviderExtension`; renderer-facing extension events use the `ext:*`
channel prefix. The renderer also has its own `src/extensions/registry.ts` for
injecting sidebar entries, routes, settings sections, chat `beforeSend` hooks,
and skill detail components.

## Key Utilities (`electron/utils/`)

| Concern | Module(s) | Notes |
|---------|-----------|-------|
| Logging | `logger.ts` | Leveled logs, dated file `userData/logs/clawx-YYYY-MM-DD.log`, ring buffer, async flush |
| Ports / config | `config.ts` | `PORTS` (dev 5173, Host API 13210, Gateway 18789), `getPort()` env override, `GATEWAY_CONFIG` timeouts |
| Paths | `paths.ts`, `openclaw-paths.ts` | `~/.openclaw`, `~/.clawx`, OpenClaw entry/logs |
| Python toolchain | `uv-setup.ts`, `uv-env.ts` | bundled `uv`, managed Python, install-all |
| OpenClaw integration | `openclaw-auth.ts`, `openclaw-cli.ts`, `openclaw-workspace.ts`, `openclaw-skills.ts`, `openclaw-doctor.ts`, `openclaw-control-ui.ts`, `openclaw-proxy.ts`, `openclaw-voice.ts` | auth-profiles, CLI auto-install, workspace bootstrap, skills, doctor, Control UI URL, proxy, voice config |
| Token usage | `token-usage-core.ts`, `token-usage.ts` | scan `.jsonl` transcripts for `message.usage`, mtime/size-keyed incremental cache |
| Proxy-aware fetch | `proxy-fetch.ts`, `proxy.ts` | system-proxy-aware HTTP |
| OAuth | `device-oauth.ts`, `browser-oauth.ts`, `feishu-oauth.ts` | provider/channel OAuth |
| Secure storage | `secure-storage.ts`, `crypto-helper.ts` | legacy provider API delegating to secret-store |

## Full Data Flow

### Chat Send Flow (with runtime streaming)

```
1. User types in ChatInput and presses send.
2. useChatStore.sendMessage():
   a. Optimistically inserts the user message.
   b. Optionally routes to a dynamic workflow if intent matches
      (lib/intent-classifier + lib/workflow-route).
   c. Calls hostApiFetch('/api/chat/send' or '/api/chat/send-with-media').
3. Main Host API (gateway.ts route) invokes Gateway chat.send over the
   WebSocket RPC.
4. Gateway emits runtime events; GatewayManager forwards chat:runtime-event.
5. Main pushes the event via webContents.send (SSE fallback available).
6. Renderer subscribeHostEvent('chat:runtime-event') ->
   handleChatEvent() updates streamingText / messages / runtimeRuns.
7. The execution graph and assistant Markdown (with KaTeX) render incrementally.
```

### Gateway Startup Flow

```
1. App initialize() -> if gatewayAutoStart, sync provider auth into OpenClaw.
2. gatewayManager.start() -> startup-orchestrator:
   a. findExistingGatewayProcess() -> reuse, or detect PortConflictError.
   b. If none: wait for port free -> launch UtilityProcess child.
   c. waitForGatewayReady() probes WS until connect.challenge is seen.
   d. connect(): WebSocket handshake + signed device-identity frame.
   e. On failure: run openclaw doctor repair; retry up to 3 spawns.
3. Status transitions emit 'status'; Main writes to HostEventBus + IPC push.
4. Renderer useGatewayStore reflects the status; Sidebar loads sessions/history
   once ready.
5. A PortConflictError surfaces PortConflictDialog -> gateway:resolve-conflict.
```

### Provider Configuration Flow

```
1. User adds/edits a provider in Settings -> ProvidersSettings.
2. useProviderStore calls hostApiFetch('/api/providers' ...).
3. providers.ts route -> provider-service:
   a. provider-validation validates the API key (with probe fallback).
   b. secret-store persists the secret; provider-store persists the account.
   c. provider-runtime-sync mirrors the change into OpenClaw runtime config.
4. OpenClaw's native config watcher applies the change. Model-changing flows
   wait for `agents.list` to expose the expected live model before returning.
5. providers:snapshot-changed is pushed so the UI refreshes.
```

### Workflow Run Flow

```
1. UI (Workflows page or an auto-routed chat task) calls
   hostApiFetch('/api/workflow/start' | '/start-dynamic').
2. workflow.ts route -> engine.start():
   a. XState actor begins; deterministic nodes run as plain functions.
   b. Model/agent nodes call the adapter (temperature=0 + zod + retries).
   c. Each transition writes a versioned snapshot to userData/workflows/.
3. workflow:progress events stream to HostEventBus + IPC.
4. useWorkflowStore / WorkflowInlineCard render live per-node progress.
5. On completion a synthesized reply is posted back into the conversation.
6. On crash/restart, listActive() snapshots are rehydrated and resumed.
```

### Quit / Teardown Flow

```
1. Tray "Quit" sets app-state isQuitting = true and calls app.quit().
2. before-quit preventDefault -> quit-lifecycle state machine:
   a. close SSE clients and Admin Console connections.
   b. stop the Host API server.
   c. extensionRegistry.teardownAll().
   d. gatewayManager.stop() (graceful; force-kill after ~5s timeout).
3. app.quit() is called again to allow the real exit.
(Closing the window button only hides to tray; it does not quit.)
```

## Realtime Events

Main -> Renderer realtime events are pushed over whitelisted IPC channels (with
an SSE fallback on `/api/events`). Notable channels:

`gateway:status-changed`, `gateway:error`, `gateway:chat-message`,
`chat:runtime-event`, `workflow:progress`, `oauth:*`, `channel:whatsapp-*`,
`update:*`, `navigate`, `openclaw:cli-installed`,
`providers:snapshot-changed`.

Gateway, Admin Console, and OAuth events are written to the `HostEventBus`
(SSE) and selected events are simultaneously delivered via `webContents.send`.

## Data Storage

YYClaw uses no database. Configuration and runtime data live in JSON/text
files and OS-managed locations:

```
~/.clawx/                       # YYClaw (YYClaw) configuration root
  logs/clawx-YYYY-MM-DD.log     # Dated, leveled main-process logs
<userData>/                     # Electron per-app userData
  clawx.instance.lock           # Single-instance file lock
  workflows/<run-id>.json       # Versioned workflow run snapshots
  (electron-store JSON files: settings, providers, window bounds, ...)
~/.openclaw/                    # Embedded OpenClaw runtime config
  openclaw.json                 # Gateway/runtime config (plain text on disk)
  auth-profiles.json            # Provider auth profiles
  skills/                       # Managed skills directory (bundled + installed)
  agents/<agent>/sessions/*.jsonl   # Append-only session transcripts
```

Token-usage history is **not** parsed from console logs: it is aggregated from
OpenClaw session transcript `.jsonl` files (normal, `.deleted.jsonl`, and
`.jsonl.reset.*` are all treated as valid history), extracting records with
`message.usage`. Because sessions directories can reach several GB, reads use an
mtime/size-keyed incremental cache.

## Internationalization (`src/i18n/`)

`react-i18next`, initialized before render in `src/i18n/index.ts`. Supported
languages: `en`, `zh`, `ja`, `ru`. Namespaces: `common`, `settings`,
`dashboard`, `chat`, `channels`, `agents`, `skills`, `cron`, `dreams`, `setup`,
`workspace`, `workflow`. English is the structural source of truth;
`zh`/`ja` mostly use deep `mergeFallback(en, overlay)`, while `ru` ships a
mostly-independent bundle. New user-facing strings must be routed through i18n
with full locale coverage -- never hardcoded.

## Styling Conventions (`src/styles/globals.css`)

A warm "YYClaw" palette is defined as HSL CSS variables for light and `.dark`,
extended in `tailwind.config.js`. Key design tokens: `bg-surface-modal`
(modals/dropdowns/cards), `bg-surface-input` (inputs/forms), `bg-brand-gradient`
(primary coral->gold), `shadow-soft` / `shadow-elevated`, and `font-serif` for
page H1/H2. Selected/hover state convention is `bg-black/5 dark:bg-white/10`;
active navigation uses `bg-primary/10 text-primary`; status colors follow
`text-X-700 dark:text-X-400`. Markdown uses a hand-rolled `.prose` subset (no
typography plugin); KaTeX CSS is imported globally in `main.tsx`.

## Architecture Invariants

These contracts are enforced by ESLint and/or the harness specs and must hold for
every change:

1. **Single frontend entry.** Renderer backend access goes only through
   `src/lib/host-api.ts` and `src/lib/host-api-client.ts`. No new direct
   `window.electron.ipcRenderer.invoke(...)` calls in pages/components.
2. **No renderer->Gateway HTTP.** The renderer never calls
   `fetch('http://127.0.0.1:18789/...')`; Gateway HTTP is reached only through
   the Main proxy channels (`hostapi:fetch`, `gateway:httpProxy`).
3. **Main owns transport.** Transport policy is fixed as `WS -> HTTP -> IPC`
   fallback and owned by Main; the renderer implements no protocol-switching
   business logic.
4. **Preload is the only bridge.** Renderer never imports Node.js modules; the
   preload `contextBridge` allowlist is the sole surface.
5. **IPC channel naming.** New channels follow `namespace:action`.
6. **Single Gateway owner.** Only one process may listen on
   `127.0.0.1:18789`.
7. **Spec-driven comms changes.** Changes touching communication paths start
   from a task spec under `harness/specs/tasks/`, reference
   `gateway-backend-communication`, and pass `pnpm run comms:replay` +
   `pnpm run comms:compare`.
8. **i18n + E2E coverage.** User-facing changes add full-locale i18n and an
   Electron Playwright E2E spec in the same change.
9. **Doc sync.** Behavior/flow/interface changes update `README.md`,
   `README.zh-CN.md`, and `README.ja-JP.md` (and this document) in the same
   change.

## Reference: Ports & Endpoints

| Name | Default | Source | Purpose |
|------|---------|--------|---------|
| GUI dev server | `5173` | `PORTS.CLAWX_DEV` | Vite dev server |
| Host API | `13210` | `PORTS.CLAWX_HOST_API` | Local REST server proxied via `hostapi:fetch` |
| OpenClaw Gateway | `18789` | `PORTS.OPENCLAW_GATEWAY` | Embedded OpenClaw runtime (WS `/ws`, HTTP) |

All ports are overridable via `CLAWX_PORT_<KEY>` environment variables
(`getPort()`).
