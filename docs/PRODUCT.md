# Product Description — YYClaw Desktop Client

## What Is This?

**YYClaw** is a cross-platform (macOS / Windows / Linux) **Electron desktop
application** that turns the command-line **OpenClaw** AI agent runtime into an
accessible, "battery-included" desktop experience. The OpenClaw runtime is
embedded and supervised as a local Gateway subprocess, so users never touch a
terminal, a YAML file, or an environment variable to get from installation to
their first AI conversation.
【补充数字员工部分的描述】

From a single window users can: chat with one or more AI agents (text, image and
voice, even other multi-modal input & output), wire up AI-powered messaging channels, schedule recurring automated tasks, run deterministic multi-step workflows, install and toggle local-first
skills, configure multiple AI providers with securely stored credentials, and
observe their token usage and runtime health.

## Product Pillars

- **Zero configuration barrier** — guided setup wizard, visual settings with
  real-time validation, no CLI required.
- **Local-first & private** — secrets in the OS keychain, runtime in a local
  Gateway, no mandatory cloud dependency.
- **Single, stable interface** — every backend feature is reached through one
  unified client; protocol and process complexity stay hidden from the user.
- **Resilient by default** — automatic Gateway lifecycle management, reconnect,
  timeout, and backoff handling.
- **Extensible** — local-first skills, a pluggable extension/marketplace layer,
  and per-agent customization.

## Feature Map

A quick index of every user-facing surface. Each row links to its detailed
section below. Add new features to this table first, then to **Core Features**.

| # | Feature | Route / Entry | One-line summary |
|---|---------|---------------|------------------|
| 1 | First-Launch Setup Wizard | `/setup/*` | Guided onboarding: language, providers, skills, verification |
| 2 | Intelligent Chat | `/` | Multi-agent chat with Markdown/LaTeX, `@agent`, `/skill`, model picker, artifacts |
| 3 | Voice Interaction | Chat + `Settings → Voice` | Talk-mode dictation/conversation input and TTS playback |
| 4 | Multi-Agent Management | `/agents` | Per-agent model, skill allowlist, channel binding, global config |
| 5 | AI Providers & Models Dashboard | System Settings → Models | Provider/key config + rolling token-usage charts |
| 6 | Multi-Channel Management | System Settings → Channels | Channel accounts, QR/OAuth linking, per-account agent binding |
| 7 | Skill System | System Settings → Skills | Local-first browse / install / enable-disable, Corperation server marketplace, disabled ClawHub |
| 8 | Cron Automation | `/cron` | Scheduled AI tasks with external delivery config and run history |
| 9 | Deterministic Workflow Engine | `/workflows` | XState-based deterministic multi-step orchestration (dev-gated) |
| 10 | Office Collaboration | `/office` | Multi-agent room collaboration on deliverables (feature-gated) |
| 11 | Agent Workspace | Chat right sidebar + per-agent Persona modal | File-tree browser and preview of the agent workspace; persona/memory files edited per-agent |
| 12 | Image Generation | `/image-generation` | Dedicated OpenAI-compatible image endpoint (dev-gated) |
| 13 | OpenClaw Dreams (Memory) | System Settings → Memory | `memory-core` dreaming: status, diary, maintenance |
| 14 | System Settings | System Settings modal (sidebar footer) | General / Gateway / Voice / Update / Developer / Doctor; plus Models / Channels / Skills / Memory tabs |
| 15 | System Integration | App shell / tray | Single-instance, tray, launch-at-startup, auto-update |
| 16 | Gateway Lifecycle | Background + status | Embedded OpenClaw supervision, health, conflict resolution |
| 17 | Theming & Localization | Global | Light/dark/system themes; `en` / `zh` / `ja` / `ru` |

---

## Core Features

> Each feature follows the same template (see
> [Extending This Document](#extending-this-document)): **Route / Entry**,
> **Summary**, **Capabilities**, **Constraints & Notes**.

### 1. First-Launch Setup Wizard

- **Route / Entry:** `/setup/*` (shown automatically on a fresh profile until
  setup is marked complete).
- **Summary:** A step-by-step wizard that takes a new user from a blank install
  to a verified, ready-to-use configuration.
- **Capabilities:**
  - **Language & Region** — preselects the system language when supported,
    falls back to English otherwise.
  - **AI Provider** — add one or more providers via API key or browser/device
    OAuth (for providers that support it).
  - **Skill Bundles** — select pre-configured skill bundles for common use
    cases; default bundled skills are installed automatically.
  - **Verification** — test the configuration before entering the main UI.
  - Completing the wizard sets a persisted "setup complete" flag and redirects
    to Chat.
- **Constraints & Notes:** The UI is fully navigable without provider keys; the
  wizard can be skipped. Gateway readiness is not required to complete setup.

### 2. Intelligent Chat

- **Route / Entry:** `/` (default landing page after setup).
- **Summary:** A modern chat experience for conversing with AI agents, with rich
  content rendering, multi-agent routing, skill/model selection, and an artifact
  side-panel.
- **Capabilities:**
  - **Conversation management** — multiple sessions, time-bucketed session list
    in the sidebar, "New Chat", and persisted history across restarts.
  - **Rich rendering** — Markdown with GitHub-flavored tables and KaTeX LaTeX
    math (`$inline$`, `$$block$$`, `\(inline\)`, `\[block\]`).
  - **`@agent` routing** — target another agent directly in the composer;
    YYClaw switches into that agent's own conversation context rather than
    relaying through the default agent.
  - **`/skill` picker** — inserts `/skillname` tokens with inline highlighting;
    click a token to preview its `SKILL.md`.
  - **Model picker** — when multiple configured models exist, switch the current
    agent's model inline through OpenClaw's native hot reload, waiting for the
    live runtime model to converge without restarting the Gateway.
  - **Attachments & media** — stage attachments in the composer; send with media.
  - **Streaming runtime** — assistant replies stream incrementally; an execution
    graph card visualizes tool/agent runtime events.
  - **Inline workflow cards** — auto-routed workflow tasks render inline as a
    process message with a progress popover (see Feature 9).
  - **Voice controls** — per-reply 🔊 TTS playback and 🎙️ dictation/Talk entry
    (see Feature 3).
- **Constraints & Notes:** Agent workspaces are separate by default; stronger
  isolation depends on OpenClaw sandbox settings. Real chat requires at least
  one configured provider key.

### 3. Voice Interaction

- **Route / Entry:** In-chat controls + `Settings → Voice`.
- **Summary:** Talk to agents and hear them reply, entirely through the OpenClaw
  kernel's native Talk/TTS Gateway RPCs (no extra services).
- **Capabilities:**
  - **Voice input (Talk mode)** — *Dictation* (push-to-talk) transcribes speech
    into the composer for review before sending; *Conversation* mode is a
    continuous hands-free dialog (listen → think → speak) with server-side voice
    activity detection and barge-in. Mode is chosen in `Settings → Voice`.
  - **Voice output (TTS)** — each assistant reply has a 🔊 play button;
    `Settings → Voice → Auto-read` reads final replies aloud automatically.
  - **Voice models** — listed alongside chat providers on the Models page;
    built-in runtimes are **OpenAI** and **MiniMax**, selected via the
    provider's `voiceRuntimeProviderId`.
- **Constraints & Notes:** Voice is strictly config-gated — when `messages.tts`
  / the transcription provider are unset, the 🔊 and 🎙️ controls are disabled
  and the desktop refuses TTS/transcription calls (no built-in fallback).
  Microphone access prompts on first use (system permission on macOS). The
  kernel's realtime transcription endpoint is fixed to `api.openai.com`; Claude
  has no speech models.

### 4. Multi-Agent Management

- **Route / Entry:** `/agents`.
- **Summary:** Create and configure multiple agents, each with its own model,
  enabled skills, and channel binding.
- **Capabilities:**
  - Per-agent **model override** (`provider/model`); agents without an override
    inherit the global default model.
  - Per-agent **skill allowlist** (`agents.list[].skills`) chosen when creating
    or editing an agent.
  - **Channel binding** — bind an agent to a channel account.
  - **Global Config** — default model selection and global toggles (e.g. speech
    synthesis enable).
- **Constraints & Notes:** Legacy global skill toggles are migrated once into
  each existing agent for backward compatibility.

### 5. AI Providers & Models Dashboard

- **Route / Entry:** `/models`.
- **Summary:** Configure AI providers and view token-usage analytics in one
  place (the dashboard is merged into this page — there is no separate
  `/dashboard`).
- **Capabilities:**
  - **Provider configuration** — add/edit providers (OpenAI, Anthropic, custom
    OpenAI-compatible gateways, and more); set API key, model, and base URL.
  - **OAuth sign-in** — OpenAI supports API key and browser OAuth (Codex
    subscription).
  - **Key validation** — validates keys, with a lightweight `/chat/completions`
    or `/responses` probe fallback when `/models` is rejected for non-auth
    reasons.
  - **Custom headers** — set a custom `User-Agent` for compatibility-sensitive
    custom endpoints.
  - **Token-usage charts** — 7-day / 30-day **rolling** windows; group by model
    or by time; cache-hit-rate computation; per-entry detail.
  - Provider definitions are loaded from the remote provider catalog when
    reachable, otherwise from bundled `resources/config/providers.json` (the two
    are either/or, not merged).
- **Constraints & Notes:** Token-usage history is aggregated from OpenClaw
  session transcript `.jsonl` files (not console logs); reads use an
  mtime/size-keyed incremental cache. The 7d/30d filters are relative rolling
  windows, not calendar buckets.

### 6. Multi-Channel Management

- **Route / Entry:** `/channels`.
- **Summary:** Configure and monitor multiple AI messaging channels, each
  operating independently with its own agent(s).
- **Capabilities:**
  - **Multiple accounts per channel**, per-account agent binding, and switching
    the channel default account directly from the page.
  - **QR / OAuth linking** — in-app QR flows (e.g. bundled Tencent personal
    WeChat plugin; WhatsApp), Feishu OAuth, etc.
  - **Live connection status** for each account.
- **Constraints & Notes:** Custom channel account IDs are enforced to
  OpenClaw-compatible canonical IDs (`[a-z0-9_-]`, lowercase, ≤64 chars, must
  start with a letter/number) to prevent routing mismatches.

### 7. Skill System

- **Route / Entry:** `/skills`.
- **Summary:** A local-first skill manager to browse, install, enable/disable,
  and locate skills, plus optional remote marketplaces.
- **Capabilities:**
  - **Local-first** — scans managed, bundled, extension, and plugin skill
    directories while excluding workspace, `.agents`, and configured extra
    directories to prevent duplicate versions.
  - **Multi-source discovery** — shows each skill's actual on-disk location and
    can open the real folder.
  - **Install sources** — server marketplace (`farmApiBaseUrl` →
    `/api/v1/skill_list`, `skill_search`, `skill_file/:name`), ClawHub (community
    or enterprise hub), with optional `Authorization: Bearer` token.
  - **Bundled skills** — document processing (`pdf`, `xlsx`, `docx`, `pptx`) plus
    `find-skills`, `self-improving-agent`, `tavily-search`, `brave-web-search`,
    `bocha-skill`; deployed to the managed skills dir (default
    `~/.openclaw/skills`) and enabled by default on first install.
- **Constraints & Notes:** Installing a server-marketplace skill first validates
  the ZIP's actual skill identity before any same-name replacement confirmation.
  A confirmed managed replacement stages the prior directory and atomically
  migrates the agent allowlist/defaults and `skills.entries`; a failed install
  restores the staged directory. Some bundled search skills need API keys
  (`TAVILY_API_KEY`, `BOCHA_API_KEY`); missing keys surface as OpenClaw runtime
  configuration errors. Community edition disables public ClawHub.

### 8. Cron-Based Automation

- **Route / Entry:** `/cron`.
- **Summary:** Schedule AI tasks to run automatically on intervals/triggers,
  with optional delivery to external channels.
- **Capabilities:**
  - **Job CRUD** — create, edit, enable/disable, and manually trigger jobs.
  - **External delivery** — configured directly in the task form with separate
    sender-account and recipient-target selectors; recipient targets are
    auto-discovered from channel directories or known session history for
    supported channels.
  - **Run history** for each job.
- **Constraints & Notes:** Delivery configuration no longer requires hand-editing
  `jobs.json`.

### 9. Deterministic Workflow Engine

- **Route / Entry:** `/workflows` (dev-mode gated) + auto-routed inline cards in
  Chat.
- **Summary:** Runs multi-step tasks through a deterministic orchestration engine
  (XState v5) in the main process, where control flow is 100% fixed and only
  explicitly marked *model*/*agent* nodes carry constrained non-determinism.
- **Capabilities:**
  - **Deterministic control flow** — which node runs, which branch is taken,
    which loop repeats is fixed.
  - **Constrained model nodes** — `temperature=0` + zod validation + bounded
    retries, with deterministic fallback paths.
  - **Per-node trace** labeling each step as **deterministic** or **model**.
  - **Crash-safe** — runs persist as versioned JSON snapshots under
    `userData/workflows/` and resume without re-running completed steps.
  - **Live progress** streamed over the `workflow:progress` event channel.
  - **Inline chat integration** — auto-routed chat tasks appear as an inline
    process message; each node runs as a child sub-session, and a final
    synthesized reply is posted back into the conversation.
- **Constraints & Notes:** The engine drives OpenClaw rather than the reverse;
  the single constrained model step talks to the configured provider directly,
  bypassing the agent loop.

### 10. Office Multi-Agent Collaboration

- **Route / Entry:** `/office` (feature-gated by `officeCollaborationEnabled`).
- **Summary:** A higher-level collaboration surface where multiple agents work
  together in rooms on project deliverables, distinct from the generic workflow
  engine.
- **Capabilities:**
  - Room/mention orchestration and task running across roles.
  - Role/scenario setup and editors (including a LangGraph custom workflow
    editor and visual preview).
  - Project deliverable filesystem handling and Office ↔ session history sync.
- **Constraints & Notes:** Exposed via `/api/office/*` only when enabled; the
  enable toggle requires a stable Gateway state.

### 11. Agent Workspace

- **Route / Entry:** `/workspace`.
- **Summary:** Browse and preview the OpenClaw agent workspace as a file tree.
- **Capabilities:** File-tree navigation and preview (Monaco code/diff viewer,
  PDF, HTML, image, sheet, and Markdown previews via the shared artifact-preview
  components).
- **Constraints & Notes:** Backed by the OpenClaw workspace tree/file routes.

### 12. Image Generation

- **Route / Entry:** `/image-generation` (dev-mode gated).
- **Summary:** A dedicated, independent OpenAI-compatible image-generation
  endpoint, separate from the chat provider.
- **Capabilities:** Configure Base URL, API key, and model name (e.g.
  `gpt-image-2`) so image generation uses a dedicated `/v1/images/generations`
  service while chat continues on the normal OpenAI provider.
- **Constraints & Notes:** Visible only in developer mode.

### 13. OpenClaw Dreams

- **Route / Entry:** `/dreams` (always available in the sidebar).
- **Summary:** Manage OpenClaw `memory-core` "dreaming" — background memory
  consolidation.
- **Capabilities:** View dreaming status, diary, run maintenance, and
  enable/disable dreaming.
- **Constraints & Notes:** Requires a running Gateway and the dreaming plugin
  configured on the OpenClaw side.

### 14. Settings

- **Route / Entry:** `/settings/*`.
- **Summary:** Centralized configuration grouped into sections.
- **Capabilities:**
  - **General** — theme (light/dark/system), language, **Launch at system
    startup**, dev-mode unlock, optional feature toggles (Office collaboration,
    prompt optimization, telemetry).
  - **Gateway** — Gateway auto-start, **Proxy** (proxy server, bypass rules, and
    developer-mode HTTP/HTTPS/ALL_PROXY overrides), Control-UI access.
  - **Voice** — input mode (dictation/conversation) and TTS auto-read.
  - **Update** — auto-check / auto-download, manual check, install-and-restart.
  - **Advanced → Developer** — OpenClaw CLI command, **Run Doctor**
    (`openclaw doctor --json`) and **Run Doctor Fix**, **Session Auto-cleanup
    Policy** (writes `session.maintenance` into `openclaw.json`), WS transport
    diagnostic toggle, UI telemetry viewer, and log viewer.
- **Constraints & Notes:** Saving proxy settings reapplies Electron networking
  immediately and restarts the Gateway; proxy is synced to OpenClaw's Telegram
  channel config when enabled.

### 15. System Integration

- **Route / Entry:** App shell, OS tray, window controls.
- **Summary:** Native desktop integration that keeps a single, well-behaved app
  instance.
- **Capabilities:**
  - **Single-instance protection** (Electron lock + file lock) prevents duplicate
    launches and contention over the Gateway listener.
  - **System tray** — closing the window hides to tray; full quit is via tray
    **Quit ClawX** (ordered, asynchronous teardown).
  - **Launch at startup**, native notifications, custom title bar / drag region.
  - **Auto-update** — checks a generic-provider feed per release channel;
    supports forced updates via `forceUpdate` in the channel manifest.
- **Constraints & Notes:** On macOS, in-app updates require running the app from
  `/Applications` (not the mounted DMG). The Gateway listener on
  `127.0.0.1:18789` must remain single-owner.

### 16. Gateway Lifecycle & Reliability

- **Route / Entry:** Background; surfaced through status indicators and dialogs.
- **Summary:** Automatic supervision of the embedded OpenClaw Gateway so users
  never manage a process by hand.
- **Capabilities:**
  - **Auto start / supervise / restart** of the Gateway subprocess; UI appears
    without waiting on Gateway readiness.
  - **Health monitoring** — periodic ping/health checks with reconnect on
    repeated misses.
  - **Port-conflict resolution** — detects an existing/foreign listener and
    surfaces a resolution dialog; runs `openclaw doctor` repair with bounded
    retries on startup failure.
  - **Graceful degradation** — the app stays usable (showing a "connecting"
    state) while the Gateway is starting or unavailable.
- **Constraints & Notes:** The main process is the sole owner of the Gateway
  WebSocket; the renderer reaches it only through Main-owned proxy channels.

### 17. Theming & Localization

- **Route / Entry:** Global (`Settings → General`).
- **Summary:** Adaptive appearance and full multi-language support.
- **Capabilities:**
  - **Themes** — light, dark, or system-synchronized, on a warm "YYClaw"
    palette.
  - **Languages** — `en`, `zh`, `ja`, `ru`; all user-facing strings routed
    through `react-i18next` with full locale coverage.
- **Constraints & Notes:** English is the structural source of truth; new
  user-facing strings must ship full-locale coverage (never hardcoded).

---

## User Interface

```
+-------------+-----------------------------------------------------------+
| TitleBar    | (macOS drag region / Windows min-max-close)               |
+-------------+-----------------------------------------------------------+
| Sidebar     | Routed page content (<Outlet>)                            |
|             |                                                           |
| New Chat    |   Chat: message stream + execution graph + artifact panel |
| ---------   |   Models: providers + token-usage charts                  |
| Sessions    |   Agents / Channels / Skills / Cron / Workflows / ...      |
| (by time)   |                                                           |
| ---------   |                                                           |
| Chat        |   +---------------------------------------------------+   |
| Models      |   | Assistant reply (Markdown + KaTeX)   [🔊]         |   |
| Agents      |   |   Citations / tool calls (execution graph)        |   |
| Channels    |   +---------------------------------------------------+   |
| Skills      |                                                           |
| Cron        |                                                           |
| Workflows*  |   +---------------------------------------------------+   |
| Workspace   |   | Composer: @agent  /skill  [model ▾]  [🎙️]  [Send] |   |
| Office*     |   +---------------------------------------------------+   |
| Dreams      |                                                           |
| Settings    |   (* dev-mode / feature-gated entries)                    |
+-------------+-----------------------------------------------------------+
| Gateway status: connecting / ready / error                              |
+-------------------------------------------------------------------------+
```

---

## Cross-Cutting Constraints

- **Local-first:** No database. Configuration and runtime data live in JSON/text
  files (`~/.clawx`, `~/.openclaw`, Electron `userData`) and the OS keychain.
- **Renderer boundary:** The renderer never opens a socket to the Gateway and
  never issues a cross-origin `fetch`; all backend access flows through
  `src/lib/host-api.ts` / `src/lib/api-client.ts`.
- **Provider keys required for real AI:** The app is fully navigable and testable
  without keys, but actual chat/voice/image generation requires a configured
  provider.
- **Config on disk:** Provider configs are written as structured plain-text JSON
  (to avoid OpenClaw config-health `.clobbered` conflicts); reading historical
  encrypted configs (`CLAWX_ENCRYPTED_v1:`) is still supported.
- **Single Gateway owner:** Only one process may listen on `127.0.0.1:18789`.
- **Feature gating:** Workflows and Image Generation are dev-mode gated; Office
  collaboration is gated by `officeCollaborationEnabled`.

## Reliability & Performance Targets

- **UI-first startup:** The main window appears without blocking on the Gateway
  (which typically becomes ready in ~10–30s).
- **Transport resilience:** Main-owned `WS → HTTP → IPC` policy with reconnect,
  timeout, and per-transport backoff; application-level retry for
  `TIMEOUT`/`NETWORK` errors.
- **Streaming chat:** Assistant replies and execution-graph nodes render
  incrementally as runtime events arrive.
- **Large-session safety:** Token-usage / dashboard reads use an mtime/size-keyed
  incremental cache so multi-GB session directories do not trigger repeated
  full-file rescans.
- **Slow-request telemetry:** Requests ≥ 800 ms or any transport fallback emit
  `api.request` telemetry for diagnostics.

---

## Extending This Document

This file is structured so that adding a feature is mechanical:

1. **Add a row** to the [Feature Map](#feature-map) table (assign the next `#`).
2. **Add a section** under [Core Features](#core-features) using the template
   below, keeping sections in the same order as the Feature Map.
3. **Update cross-cutting sections** only if the feature introduces a new
   constraint, gate, or performance characteristic.
4. **Keep companion docs in sync** — reflect behavior/flow/interface changes in
   `ARCHITECTURE.md`, `RELIABILITY.md`, and the localized `README.*` files in the
   same change (per the project's doc-sync rule).

### Feature Section Template

```md
### N. Feature Name

- **Route / Entry:** <route, sidebar entry, or surface where users reach it>
- **Summary:** <1–2 sentences on what it does and why it exists>
- **Capabilities:**
  - <bullet of a concrete, user-visible behavior>
  - <...>
- **Constraints & Notes:** <gating, prerequisites, limits, caveats>
```

### Authoring Conventions

- One feature = one numbered section; keep the Feature Map and Core Features in
  the same order.
- Prefer concrete, user-visible behavior over implementation detail (link to
  `ARCHITECTURE.md` for internals).
- Mark gating explicitly (dev-mode, feature flag, Gateway-required).
- Note i18n / E2E coverage expectations live in `AGENTS.md`; user-facing changes
  must ship full-locale strings and an Electron E2E spec.
