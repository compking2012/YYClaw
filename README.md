
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="YYClaw Logo" />
</p>

<h1 align="center">YYClaw</h1>

<p align="center">
  <strong>The Desktop Interface for OpenClaw AI Agents</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#why">Why YYClaw</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/YYClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ru-RU.md">Русский</a>
</p>

---

## Overview

**YYClaw** bridges the gap between powerful AI agents and everyday users. Built on top of [OpenClaw](https://github.com/OpenClaw), it transforms command-line AI orchestration into an accessible, beautiful desktop experience—no terminal required.

*Note on Configuration Storage:* Currently, all configuration files (including `openclaw.json`, `auth-profiles.json`, etc.) are written as **plain text** on disk for both development and production builds. This mitigates conflicts with OpenClaw's upstream config-health observe mechanism (which may generate `.clobbered` backup files if parsing or size changes unexpectedly). Reading of historical encrypted configs (`CLAWX_ENCRYPTED_v1:`) is still supported.

Whether you're automating workflows, managing AI-powered channels, or scheduling intelligent tasks, YYClaw provides the interface you need to harness AI agents effectively.

YYClaw comes pre-configured with best-practice model providers and natively supports Windows as well as multi-language settings. Of course, you can also fine-tune advanced configurations via **Settings → Advanced → Developer Mode**.

## Screenshots

<table>
  <tr>
    <td align="center"><img src="resources/screenshot/en/chat.png" alt="Chat"><br><em>Chat</em></td>
    <td align="center"><img src="resources/screenshot/en/cron.png" alt="Cron"><br><em>Scheduled tasks</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/en/skills.png" alt="Skills"><br><em>Skills</em></td>
    <td align="center"><img src="resources/screenshot/en/channels.png" alt="Channels"><br><em>Channels</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/en/models.png" alt="Models"><br><em>Models</em></td>
    <td align="center"><img src="resources/screenshot/en/settings.png" alt="Settings"><br><em>Settings</em></td>
  </tr>
</table>

## Why YYClaw

Building AI agents shouldn't require mastering the command line. YYClaw was designed with a simple philosophy: **powerful technology deserves an interface that respects your time.**

| Challenge | YYClaw Solution |
|-----------|----------------|
| Complex CLI setup | One-click installation with a guided setup wizard |
| Configuration files | Visual settings with real-time validation |
| Process management | Automatic gateway lifecycle management |
| Process management | Automatic Gateway lifecycle management |
| App updates | Startup update checks with a prompt before downloading or installing |
| Multiple AI providers | Unified provider configuration panel |
| Skill/plugin installation | Local-first skill management with an optional extension-provided marketplace |

### Features

YYClaw is built directly upon the official **OpenClaw** core. Instead of requiring a separate installation, we embed the runtime within the application to provide a seamless "battery-included" experience.
- **🎯 Zero Configuration Barrier**: Complete setup through an intuitive graphical interface - no terminal commands, YAML files, or environment-variable hunting.
- **💬 Intelligent Chat Interface**: Multi-session context and history, streaming Markdown with syntax highlighting, CJK-aware parsing, tables, KaTeX math, direct `@agent` routing, inline `/skill` cards, workspace-first sessions, and read-only previews for Markdown, `.docx`, `.pptx`, and local HTML.
- **📡 Multi-Channel Management**: Configure and monitor independent AI channels with multiple accounts, per-account agent binding, default-account switching, and the bundled official Tencent personal WeChat channel plugin.
- **⏰ Cron-Based Automation**: Define recurring or one-time schedules, insert skills into scheduled prompts, and deliver results to external channels.
- **🧩 Extensible Skill System**: Manage skills locally without depending on the Gateway, discover skills from multiple OpenClaw sources, and use bundled document-processing skills for `pdf`, `xlsx`, `docx`, and `pptx`.
- **🔐 Secure Provider Integration**: Connect OpenAI, Anthropic, Z.AI / GLM, and other providers with credentials stored in the native system keychain; supports OAuth, custom providers, image-generation endpoints, and compatibility fallbacks.
- **🌙 Adaptive Theming**: Choose light mode, dark mode, or system-synchronized themes.
- **🚀 Startup Launch Control**: Enable **Launch at system startup** in **Settings -> General**.
- **🔔 Update Prompts**: Check for new versions at startup and choose whether to download or install them.

> For full feature details, see [docs/en-US/features.md](docs/en-US/features.md).

---

## Features

### 🎯 Zero Configuration Barrier
Complete the entire setup—from installation to your first AI interaction—through an intuitive graphical interface. No terminal commands, no YAML files, no environment variable hunting.

### 💬 Intelligent Chat Interface
Communicate with AI agents through a modern chat experience. Support for multiple conversation contexts, message history, assistant replies rendered with Markdown (including GitHub-flavored tables and KaTeX-powered LaTeX math: `$inline$`, `$$block$$`, `\(inline\)`, and `\[block\]`) while user input remains literal text, and direct `@agent` routing in the main composer for multi-agent setups.
When you target another agent with `@agent`, YYClaw switches into that agent's own conversation context directly instead of relaying through the default agent. Agent workspaces stay separate by default, and stronger isolation depends on OpenClaw sandbox settings.
Skills you insert from the composer appear as `/skill-name` chips; click a chip to open the preview sidebar and read that skill's `SKILL.md`.
When you target another agent with `@agent`, YYClaw switches into that agent's own conversation context directly instead of relaying through the default agent. Agent workspaces stay separate by default, and stronger isolation depends on OpenClaw sandbox settings.
The session sidebar is workspace-first: the default workspace stays at the top, other workspaces sort naturally, and each workspace can collapse or load more sessions. A row shows a spinner while the AI is replying, a blue dot when an unseen reply finishes, and its relative activity time after the conversation is opened; hovering still reveals row actions. Imported workspaces can be renamed from their sidebar header; the custom name is reflected in the chat composer while hovering the header still reveals the filesystem path. When available, a new chat inherits the selected conversation's workspace while remaining editable until first send. Editable new or unbound chats expose the composer workspace chip as a small menu that lists recent and known-session workspaces, returns to the default workspace, or chooses another folder. If a saved workspace folder was moved or deleted, Chat pauses session creation and prompts you to choose an existing folder instead of repeatedly retrying the missing path. Unavailable non-default groups are marked in the sidebar and can be removed after confirmation; this permanently deletes every session in that group. Synthetic OpenClaw UUID-date fallback titles are treated as missing only when they match the session ID, then replaced with the conversation's first user prompt instead of being persisted as the session name. On a cold start or after a gateway restart — when you have not opened a specific conversation yet — Chat lands on a brand-new empty conversation rather than resurrecting the most recently updated session; existing sessions stay listed in the sidebar.
Each agent can also override its own `provider/model` runtime setting; agents without overrides continue inheriting the global default model.
The chat composer also includes a **Skills** picker (inserts `/skillname  ` tokens with inline highlighting; click a token to preview `SKILL.md`) and a **Model** picker when multiple configured models are available. Model changes are applied by OpenClaw's native config watcher without restarting the Gateway; YYClaw waits for the live `agents.list` snapshot to expose the selected model before allowing the next send. Skills are now scoped per agent (`agents.list[].skills`): creating/editing an agent lets you choose that agent's enabled skills, and global skill toggles are migrated to each existing agent once for backward compatibility.

### 🎙️ Voice Interaction
Talk to your agents and hear them reply. Voice runs entirely through the OpenClaw kernel's native Talk/TTS gateway RPCs — no extra services.
- **Voice input** uses OpenClaw **Talk mode**. *Dictation* (push-to-talk) transcribes your speech into the composer for review before sending; *Conversation* mode opens a continuous hands-free dialog (listen → think → speak) with server-side voice activity detection and barge-in. Switch modes in **Settings → Voice**.
- **Voice output (TTS)**: each assistant reply has a 🔊 play button, and **Settings → Voice → Auto-read** can read final replies aloud automatically.
- **Voice models** are listed alongside chat providers on the **Models** page. Provider definitions come from the remote provider catalog when it is reachable, falling back to the bundled `resources/config/providers.json` otherwise (the two are either/or, not merged) — so which capability types are offered (including `tts` / `transcription` / `realtime`) depends on that source. Configure the provider's API key, model, and base URL; selections are written to the OpenClaw config (`messages.tts` and the `voice-call` plugin). This release supports two built-in voice runtimes — **OpenAI** and **MiniMax** — selected via the provider's `voiceRuntimeProviderId`. Voice params (voice / audio format / speed, etc.) are built into those runtimes and are not user-configurable for now; a voice-capable provider only needs to declare its voice model id, and saving the account — or switching it to be the default provider — bridges those kinds into the same OpenClaw voice config sections. Deleting a voice provider — or turning off speech synthesis in the Agents **Global Config** (now a standard enable toggle) — removes the related entries from those voice config sections again, promoting another configured provider as the default when one is still available. Note: OpenAI TTS honors the base URL, but the kernel's realtime transcription endpoint is fixed to `api.openai.com` (base URL not yet applied there), and realtime voice requires a kernel capability plugin matching the voice provider id. Anthropic Claude has no speech models — use Claude as the chat brain with another provider's TTS/ASR. Voice is strictly config-gated: when `messages.tts` / the transcription provider are not set in the config, the corresponding UI controls (the 🔊 play button and the 🎙️ record button) are disabled, and the desktop refuses TTS/transcription calls — there is no built-in default fallback.
- Microphone access prompts on first use; on macOS the app requests the system microphone permission.

### 🌙 OpenClaw Dreams
The **Memory** tab (in System Settings) manages OpenClaw `memory-core` dreaming (status, diary, maintenance, enable/disable). Requires a running Gateway and the dreaming plugin configuration on the OpenClaw side.

The Workspace and Preview tabs in Chat's right panel provide read-only previews for `.docx` and `.pptx` files. The Preview header can expand the selected file to the full YYClaw viewport; use the same control or Escape to return to the panel. Legacy `.doc` and `.ppt` files continue to open through the operating system instead of inline. DOCX pagination may differ from Microsoft Word, and PPTX previews do not support animations, transitions, or media playback. Office files larger than 20 MB are not previewed inline.

### Local HTML Preview
The Chat right panel has Workspace, Preview, and Changes tabs; it no longer includes a general Web Browser, Home page, or address bar. Authorized local `.html` and `.htm` attachments, file activities, and Workspace files open in Preview by default. Their file actions let you choose the built-in Preview or a system application, and the Preview header can open the current HTML file in the system browser.

All links are non-clickable. Links rendered by YYClaw appear as ordinary text, and links inside HTML Preview have their styling and pointer interaction removed. HTML Preview also blocks forms, script navigation, redirects, hash navigation, popups, downloads, network requests, and device permissions. It can render self-contained local HTML but cannot leave the selected document.

### 📡 Multi-Channel Management
Configure and monitor multiple AI channels simultaneously. Each channel operates independently, allowing you to run specialized agents for different tasks.
Each channel now supports multiple accounts and switching the channel default account directly from the Channels page. Binding channel accounts to agents lives on the Agents page: each agent card has a **Bind Channels** button that opens a modal for binding multiple channel accounts to that agent at once (each account is handled by one agent at a time).
For custom channel account IDs, YYClaw enforces OpenClaw-compatible canonical IDs (`[a-z0-9_-]`, lowercase, max 64 chars, must start with a letter/number) to prevent routing mismatches.
YYClaw now also bundles Tencent's official personal WeChat channel plugin, so you can link WeChat directly from the Channels page with an in-app QR flow.
One-click Feishu app creation also auto-configures a **Quick Commands** bot menu (`/new`, `/stop`, `/reset`, `/status`, `/compact`) so users can drive OpenClaw session control by tapping the bot menu instead of typing.

### ⏰ Cron-Based Automation
Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock without manual intervention.
The Cron page now lets you configure external delivery directly in the task form with separate sender-account and recipient-target selectors. For supported channels, recipient targets are discovered automatically from channel directories or known session history, so you no longer need to edit `jobs.json` by hand. The task message field also supports inserting skills with the same inline `/skill` token syntax as the main chat composer (scoped to the selected agent), so scheduled prompts can trigger skills directly. The schedule picker is split into **Recurring** and **Once** tabs: Recurring offers Hourly, Daily, Weekdays, Weekly, and Custom (raw cron) frequencies with inline time/weekday controls, while Once runs the task a single time at a chosen date (with weekday shown) and time. One-time tasks must be scheduled for a future moment and are automatically removed by the runtime once they finish. On upgrade to a SQLite-backed runtime, YYClaw silently re-creates any recoverable user jobs from legacy `jobs.json` / `jobs.json.bak` into the new store on first launch and archives the originals under `~/.openclaw/cron/legacy-archive/`; `[managed-by=...]` internal jobs are left for the runtime to rebuild.


### 🔀 Deterministic Workflow Engine
For tasks with clearly defined steps, the **Workflows** page runs a deterministic orchestration engine (XState v5) in the main process. Control flow — which node runs, which branch is taken, which loop repeats — is 100% fixed; only nodes explicitly marked as *model* (or *agent*) steps carry non-determinism, and that is constrained with a schema (`temperature=0` + zod validation + bounded retries) and can fall back to a deterministic path. Each run produces a per-node trace that labels every step as **deterministic** or **model**, runs are persisted as versioned JSON snapshots under `userData/workflows/` (so a crash resumes without re-running completed steps), and live progress streams to the UI over the `workflow:progress` event channel. The engine drives OpenClaw rather than the reverse: deterministic steps run as plain main-process functions, while a single constrained model step talks to the configured provider directly (bypassing the agent loop). When a chat task is auto-routed to a workflow, it appears **inline in the conversation** as a process message — the query bubble shows immediately and the composer reuses the same *thinking* indicator a normal turn shows while the server decomposes the task (the workflow card's compact link stays hidden during this window); once the plan resolves the card's link appears in place and its floating progress popover opens automatically, and you can click the card to reopen the popover or click away to dismiss — each node runs as a child sub-session of the main conversation (not a separate top-level session), and on completion a final synthesized reply is posted back into the conversation.


### 🧩 Extensible Skill System
Extend your AI agents with pre-built skills. The integrated Skills page is local-first: it scans the managed directory plus bundled, extension, and plugin skills, while workspace, `.agents`, and `skills.load.extraDirs` are excluded to prevent duplicate versions. You can enable or disable skills without depending on the Gateway—no package managers required.
Use a single **`farmApiBaseUrl`** in root `package.json` (scheme + host + port only, e.g. `http://aiserver.example.com:9001`) for YYClaw server features. The app loads the AI provider catalog from `GET /api/v1/provider-catalog` on that base, and the **Install Skills** side panel (server source) uses the same base for `GET /api/v1/skill_list` (browse), `GET /api/v1/skill_search?q=` (filter), and `GET /api/v1/skill_file/:name` (install zip). Optional `Authorization: Bearer` uses the Farm auth token from app settings when set.
YYClaw also pre-bundles full document-processing skills (`pdf`, `xlsx`, `docx`, `pptx`) from `anthropics/skills`, plus a curated catalog (GitHub, tmux, Notion, Obsidian, Trello, weather, and more) vendored at build time via the standalone `skills` CLI (`npx skills add …`, independent of the OpenClaw CLI). All are deployed automatically to the managed skills directory (default `~/.openclaw/skills`) on startup and enabled by default on first install. Platform-restricted skills (e.g. the Apple ones) are only deployed on macOS.
The Skills page shows each skill's actual location so you can open the real folder directly. Installing a managed skill with the same metadata name or slug asks for confirmation; confirmed replacement is transactional, so a failed install restores the previous copy.

### 🔐 Secure Provider Integration
Connect to multiple AI providers (OpenAI, Anthropic, Z.AI / GLM, and more) with credentials stored securely in your system's native keychain. OpenAI supports both API key and browser OAuth (Codex subscription) sign-in.
In developer mode, the dedicated Image Generation page supports an independent OpenAI-compatible image-generation endpoint (Base URL, API key, and model name such as `gpt-image-2`) so image generation can use a dedicated `/v1/images/generations` service while chat continues using the normal OpenAI provider.
Natural-language image generation in Chat does not need that developer page. Give any provider account an `image_generate` model kind in **Settings → AI Providers** and its own provider key (e.g. `gptimage2-gptimage/gpt-image-2`) works directly — YYClaw's two bundled image plugins self-detect from `openclaw.json` which provider keys host their own model family (`gpt-image-*` / `dall-e-*` for `clawx-openai-image`, `gemini-*-image` for `clawx-gemini-image`) and register those keys as aliases, so no new `models.providers` entry is created and no API key is copied. This exists because OpenClaw only resolves image generation against providers registered in its image-generation registry — a plain `models.providers` entry never qualifies on its own. The model id already fixed in `imageGenerationModel.primary` decides the wire protocol, so nothing is probed at request time; a model in neither family (e.g. minimax `image-01`, Google `imagen-*`) is left to OpenClaw's own built-in providers. The split between the two plugins is required, not cosmetic: OpenAI-compatible relays reject non-imagen Gemini models on `/v1/images/generations`, and OpenClaw's built-in `google` image provider pins its base URL to `generativelanguage.googleapis.com`, so it cannot serve a relay. YYClaw's prelaunch step also sets `agents.defaults.mediaGenerationAutoProviderFallback = false` whenever either plugin is needed, so a model the relay cannot generate fails with the relay's own error instead of silently rendering through another authenticated provider.
For **Custom** providers used with OpenAI-compatible gateways, you can set a custom `User-Agent` in **Settings → AI Providers → Edit Provider** for compatibility-sensitive endpoints.
When you edit or switch providers, YYClaw preserves existing per-model capability metadata such as `input: ["text", "image"]`. Newly selected Custom-provider models use OpenClaw onboarding-compatible image-input inference, with unknown models defaulting to text-only.
Custom-provider model rows also receive an explicit `contextWindow` (inferred from the model family, e.g. `gpt-5.x` → 272k), and rows saved by older versions are backfilled on startup, so OpenClaw can compact long sessions before they fail with "Context overflow" errors. When you have no compaction config, YYClaw seeds `agents.defaults.compaction.mode = "safeguard"` and `reserveTokensFloor = 50000`; rows or configs you authored yourself are never modified (except a missing `reserveTokensFloor` may be backfilled).
Z.AI (CN / Global) maps to OpenClaw's built-in `zai` provider (`ZAI_API_KEY`). Default model is `glm-5.2`. Use the Code Plan preset for Coding Plan endpoints (`…/api/coding/paas/v4`) or the normal API endpoints (`…/api/paas/v4`); CN and Global are mutually exclusive because they share one OpenClaw runtime key.
When a compatible gateway rejects `/models` for non-auth reasons, YYClaw automatically falls back to a lightweight `/chat/completions` or `/responses` probe during API key validation.

### 🌙 Adaptive Theming
Light mode, dark mode, or system-synchronized themes. YYClaw adapts to your preferences automatically.

### 🚀 Startup Launch Control
In **Settings → General**, you can enable **Launch at system startup** so YYClaw starts automatically after login.

---
### Typical Use Cases

- **🤖 Personal AI Assistant**: Configure a general-purpose AI agent to answer questions, draft emails, summarize documents, and help with everyday tasks from a clean desktop interface.
- **📊 Automated Monitoring**: Schedule agents to monitor news feeds, track prices, or watch for specific events, with results delivered to your preferred notification channel.
- **💻 Developer Productivity**: Integrate AI into your development workflow for code review, documentation generation, and repetitive coding tasks.
- **🔄 Workflow Automation**: Chain multiple skills into visual automation pipelines that process data, transform content, and trigger actions.

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 1GB available disk space

### Installation

#### Pre-built Releases (Recommended)

Download the latest release for your platform from the [Releases](https://github.com/ValueCell-ai/YYClaw/releases) page.

#### Build from Source

```bash
# Clone the repository
git clone https://github.com/ValueCell-ai/YYClaw.git
cd YYClaw

# Initialize the project
pnpm run init

# Start in development mode
pnpm dev
```

### First Launch

When you launch YYClaw for the first time, the **Setup Wizard** will guide you through:

1. **Language & Region** - Configure your preferred locale
2. **AI Provider** - Add providers with API keys or OAuth for providers that support browser or device login
3. **Skill Bundles** - Select pre-configured skills for common use cases
4. **Verification** - Test your configuration before entering the main interface

The wizard preselects your system language when it is supported, and falls back to English otherwise.

> Note for Moonshot (Kimi): YYClaw keeps Kimi web search enabled by default.  
> When Moonshot is configured, YYClaw also syncs Kimi web search to the China endpoint (`https://api.moonshot.cn/v1`) in OpenClaw config.

### Proxy Settings

YYClaw includes built-in proxy settings for environments where Electron, the OpenClaw Gateway, or channels such as Telegram need to reach the internet through a local proxy client.

Open **Settings -> Gateway -> Proxy** to configure the default proxy, bypass rules, and optional developer-mode overrides for HTTP, HTTPS, and `ALL_PROXY` / SOCKS. A local example is `http://127.0.0.1:7890`.

- **Proxy Server**: the default proxy for all requests
- **Bypass Rules**: hosts that should connect directly, separated by semicolons, commas, or new lines
- In **Developer Mode**, you can optionally override:
  - **HTTP Proxy**
  - **HTTPS Proxy**
  - **ALL_PROXY / SOCKS**

Recommended local examples:

```text
Proxy Server: http://127.0.0.1:7890
```
Notes:

- A bare `host:port` value is treated as HTTP.
- If advanced proxy fields are left empty, YYClaw falls back to `Proxy Server`.
- Saving proxy settings reapplies Electron networking immediately and restarts the Gateway automatically.
- YYClaw also syncs the proxy to OpenClaw's Telegram channel config when Telegram is enabled.
- Gateway restarts preserve an existing Telegram channel proxy if YYClaw proxy is currently disabled.
- To explicitly clear Telegram channel proxy from OpenClaw config, save proxy settings with proxy disabled.
- In **Settings → Advanced → Developer**, you can run **OpenClaw Doctor** to execute `openclaw doctor --json` and inspect the diagnostic output without leaving the app.
- In **Settings → Advanced** (with Developer Mode enabled), a **Session Auto-cleanup Policy** form writes `session.maintenance` (mode / pruneAfter / maxEntries / maxDiskBytes) into `openclaw.json` so the Gateway prunes old/over-budget sessions on its own schedule; `mode` defaults to `enforce` and is seeded automatically on startup if unset. Session transcripts under `~/.openclaw/agents/*/sessions/` are append-only and can reach several GB; the dashboard/usage readers now reuse an mtime/size-keyed incremental cache so a large sessions directory no longer triggers repeated full-file rescans on the main process.
- On packaged Windows builds, the bundled `openclaw` CLI/TUI runs via the shipped `node.exe` entrypoint to keep terminal input behavior stable.

---
> For proxy fallback behavior, Telegram synchronization, and **OpenClaw Doctor**, see [docs/en-US/proxy-settings.md](docs/en-US/proxy-settings.md).

## Application updates

**macOS:** For in-app updates (automatic or when you choose **Install and restart**), copy YYClaw into **/Applications** from the DMG and run it from there. If you launch the app directly from the mounted DMG (or another read-only volume), the updater may be unable to replace the app bundle and the install step can appear to do nothing.

---

## Application updates (maintainers)

The main process checks the generic-provider feed under `{CDN}/{channel}/` (channel follows app semver, e.g. stable → `latest`). To **force** users to upgrade, publish `forceUpdate: true` at the **root** of the channel’s `*-mac.yml` / `*.yml` so `electron-updater` passes it through to the UI. The channel directory must match the app’s prerelease tag or stable builds will read the wrong manifest.

---

## Architecture

YYClaw employs a **dual-process architecture** with a unified host API layer. The renderer talks to a single client abstraction, while Electron Main owns protocol selection and process lifecycle:

- **Process model**: Electron Main owns the window, Gateway supervision, system integration, and updates; the OpenClaw Gateway provides AI orchestration, channel, and skill capabilities; the renderer does not access local endpoints directly.
- **Configuration delivery**: Main uses `config.get`/`config.set` while the Gateway is running and updates the resolved JSON5 config while it is stopped or starting; ordinary provider, agent, skill, and model changes do not replace the process, credentials are hot-reloaded through `secrets.reload`, and guarded recovery starts after four consecutive heartbeat misses.
- **ACP Chat**: Chat UI talks to OpenClaw via [ACP (Agent Client Protocol)](https://agentclientprotocol.com), providing a relatively stable chat protocol surface in front of the rapidly iterating OpenClaw. ACP runs through a Main-owned stdio bridge, supporting authenticated history replay after config reloads, streaming across navigation, and Main-validated media, attachments, and file activity. When a guarded Gateway restart interrupts an accepted turn, the patched OpenClaw runtime explicitly links its recovery run to the original ACP prompt so subsequent text and tool activity continue in the same in-memory turn; later history replay restores persisted tool boundaries as native ACP updates.
- **Design principles**: One frontend entry point, Main-owned transport, graceful recovery with reconnect/timeout/backoff, secure storage, and CORS-safe boundaries.

An unfinished ACP response keeps streaming when you open another conversation or page. Returning before it finishes restores the latest in-memory timeline and continues the live response; once it finishes, normal ACP history replay remains the source of truth.

ACP assistant turns show whole-turn duration. Live timing follows the client-observed prompt lifecycle and survives in-app navigation; historical timing is derived in Electron Main from bounded OpenClaw transcript timestamps and only annotates a turn already restored by ACP replay.

ACP Chat renders standard ACP resources as attachments. User-selected images appear as thumbnails with a filename hover overlay, while other available attachment cards show the filename and a muted, truncating source path. When the current OpenClaw ACP adapter omits assistant media, canonical persisted OpenClaw media facts and explicit assistant `MEDIA:` directives can also be recovered as attachment cards without displaying transcript-only metadata. Existing local file references, including paths outside the active workspace, are revalidated in Electron Main for the exact session and generation before every preview or open. Previewable local attachments produced by the AI, including `.docx` and `.pptx` files within the 20 MB inline-preview limit, keep their primary read-only in-app preview action and provide a secondary menu for opening with compatible applications or revealing the file in Finder, File Explorer, or the system file manager. For local HTML attachments, that menu starts with an action that opens the file in the right-side Preview tab. The same Office limitations apply here: `.doc` and `.ppt` remain system-open formats, DOCX pagination may differ from Microsoft Word, and PPTX animations, transitions, and media playback are unsupported. Compatible-application discovery is available only on macOS and Windows and silently degrades to reveal-only behavior on Linux or when discovery fails. Other local files, including Office files larger than 20 MB, open in the system application after a user click. User-selected folder attachments also remain available after send and open in the system file manager; YYClaw does not read or preview their contents. Remote HTTP and HTTPS attachments open externally after a user click. Bare or inline prose paths without canonical media facts are not treated as attachments.

ACP Chat can also display generated image previews when image-generation media is delivered by the runtime as trusted structured media. Trusted OpenClaw internal-UI deliveries and task-correlated final replies preserve the original user-facing completion text, including text-only failure explanations, rather than replacing it with a generic image caption. During historical OpenClaw replay, assistant image `MEDIA:` markers are promoted to the inline image experience only when they follow a recorded image-generation task start for that session. YYClaw loads previews through host media handling in Electron Main, not arbitrary Renderer filesystem access. Standard ACP image and resource content remains the preferred path and renders directly.

### ACP File Activity Semantics

- File activity is projected from successful, completed OpenClaw `write`, `edit`, and `apply_patch` calls. Tool recognition follows the official OpenClaw Chat UI; filtering to completed calls is specific to YYClaw.
- Created and modified activity rows use the same file-card shell and **Open with** menu as previewable assistant attachments while retaining their status and optional `+/-` summary. For HTML files, the first menu item opens the file in the right-side Preview tab. Deleted rows keep only the **Changes** action. Every application-list, selected-application, and reveal request is independently revalidated in Electron Main from the workspace root and relative path; tool-derived paths never become attachments or expose canonical native paths to Renderer.
- A `write` is shown as the tool declares it: a creation with an all-added diff, even if the path may already exist.
- **Changes** is a chronological, session-level record of tool-declared activity. It is not Git output or a verified diff against a source baseline.
- For each file, Changes renders at most one diff editor per assistant turn. Sequential fragments are composed when safe; independent fragments share one concatenated editor without claiming a complete-file baseline.
- Side effects made by shell commands, scripts, users, or IDEs are not detected.
- A full ACP replay can restore recorded file activity. If replay is incomplete, YYClaw does not infer missing activity through fallback behavior.

```
┌─────────────────────────────────────────────────────────────────┐
│                        YYClaw Desktop App                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron Main Process                          │  │
│  │  • Window & application lifecycle management               │  │
│  │  • Gateway process supervision                              │  │
│  │  • System integration (tray, notifications, keychain)       │  │
│  │  • Auto-update orchestration                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC (authoritative control plane)  │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React Renderer Process                         │  │
│  │  • Modern component-based UI (React 19)                     │  │
│  │  • State management with Zustand                            │  │
│  │  • Unified host-api/api-client calls                        │  │
│  │  • Markdown assistant replies, literal user input           │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Typed IPC requests
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                Main Host Services & Gateway Manager              │
│                                                                  │
│  • host:invoke typed service dispatcher                          │
│  • Settings, files, sessions, skills, providers, diagnostics     │
│  • Main-owned Gateway WebSocket and process supervision          │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ Main-owned WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                             │
│                                                                  │
│  • AI agent runtime and orchestration                           │
│  • Message channel management                                    │
│  • Skill/plugin execution environment                           │
│  • Provider abstraction layer                                    │
└─────────────────────────────────────────────────────────────────┘
```
### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, ensuring UI responsiveness even during heavy computation
- **Single Entry for Frontend Calls**: Renderer requests go through host-api/api-client; protocol details are hidden behind a stable interface
- **Main-Process Transport Ownership**: Electron Main owns the ACP Chat stdio bridge and Gateway transports; the renderer talks to Main over typed IPC
- **Extension IPC Contributions**: Main-process extensions contribute host-api actions through the typed IPC registry instead of HTTP routes
- **Graceful Recovery**: Built-in reconnect, timeout, and backoff logic handles transient failures automatically
- **Secure Storage**: API keys and sensitive data leverage the operating system's native secure storage mechanisms
- **CORS-Safe by Design**: The renderer does not call local Gateway or Host API HTTP endpoints directly

### Process Model & Gateway Troubleshooting

- YYClaw is an Electron app, so **one app instance normally appears as multiple OS processes** (main/renderer/zygote/utility). This is expected.
- Single-instance protection uses Electron's lock plus a local process-file lock fallback, preventing duplicate app launch in environments where desktop IPC/session bus is unstable.
- During rolling upgrades, mixed old/new app versions can still have asymmetric protection behavior. For best reliability, upgrade all desktop clients to the same version.
- The OpenClaw Gateway listener should still be **single-owner**: only one process should listen on `127.0.0.1:18789`.
- To verify the active listener:
  - macOS/Linux: `lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 18789 -State Listen`
- Clicking the window close button (`X`) hides YYClaw to tray; it does **not** fully quit the app. Use tray menu **Quit YYClaw** for complete shutdown.
- If the Gateway fails to start with `OpenClaw package not found at: <install>/resources/openclaw`, the bundled runtime is missing from the install directory. Auto-reconnect is disabled for this failure because retrying cannot restore files — reinstall YYClaw.

---

## Use Cases

### 🤖 Personal AI Assistant
Configure a general-purpose AI agent that can answer questions, draft emails, summarize documents, and help with everyday tasks—all from a clean desktop interface.

### 📊 Automated Monitoring
Set up scheduled agents to monitor news feeds, track prices, or watch for specific events. Results are delivered to your preferred notification channel.

### 💻 Developer Productivity
Integrate AI into your development workflow. Use agents to review code, generate documentation, or automate repetitive coding tasks.

### 🔄 Workflow Automation
Chain multiple skills together to create sophisticated automation pipelines. Process data, transform content, and trigger actions—all orchestrated visually.

---
> For the process diagram, configuration coordination, ACP file activity semantics, and Gateway troubleshooting, see [docs/en-US/architecture.md](docs/en-US/architecture.md).

## Development

### Prerequisites

- **Node.js**: 22.22.3+, 24.15.0+, or 25.9.0+ within the corresponding supported major line (Node 24 LTS recommended)
- **Package Manager**: pnpm 9+ (npm is also supported)
- **Linux (Ubuntu/Debian)**: Install required system libraries before running Electron; see [docs/en-US/development.md](docs/en-US/development.md)

### Project Structure

```YYClaw/
├── electron/                 # Electron Main Process
│   ├── services/            # Typed host APIs, provider, secrets and runtime services
│   │   ├── providers/       # Provider/account model sync logic
│   │   └── secrets/         # OS keychain and secret storage
│   ├── shared/              # Shared provider schemas/constants
│   │   └── providers/
│   ├── main/                # App entry, windows, IPC registration
│   ├── gateway/             # OpenClaw Gateway process manager
│   ├── preload/             # Secure IPC bridge
│   └── utils/               # Utilities (storage, auth, paths)
├── src/                      # React Renderer Process
│   ├── lib/                 # Unified frontend API + error model
│   ├── stores/              # Zustand stores (settings/chat/gateway)
│   ├── components/          # Reusable UI components
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # Localization resources
│   └── types/               # TypeScript type definitions
├── tests/
│   ├── e2e/                 # Playwright Electron end-to-end smoke tests
│   └── unit/                # Vitest unit/integration-like tests
├── resources/                # Static assets (icons/images)
└── scripts/                  # Build and utility scripts
```
### Available Commands
### Common Commands

```bash
pnpm run init        # Install dependencies and download bundled runtimes
pnpm dev             # Start in development mode with hot reload
pnpm lint            # Run ESLint
pnpm typecheck       # TypeScript validation
pnpm test            # Run unit tests
pnpm run test:e2e    # Run Electron E2E smoke tests
pnpm build           # Full production build
pnpm package         # Package for the current platform (:mac / :win / :linux)
```

> Building the Linux `.deb` on macOS requires GNU tar and GNU ar — run `brew install gnu-tar binutils` first. Without them, the bundled `fpm` silently emits a 96-byte empty `.deb` (an invalid archive) while the build still reports success; `pnpm package:linux` now fails fast if either is missing.

On headless Linux, run Electron tests under a display server such as `xvfb-run -a pnpm run test:e2e`.

### Communication Regression Checks

When a PR changes communication paths (gateway events, ACP Chat bridge send/receive flow, channel delivery, or transport fallback), run:

```bash
pnpm run comms:replay
pnpm run comms:compare
```

`comms-regression` in CI enforces required scenarios and threshold checks.

### Electron E2E Tests

The Playwright Electron suite launches the packaged renderer and main process
from `dist/` and `dist-electron/`, so it does not require manually running
`pnpm dev` first.

`pnpm run test:e2e` automatically:

- builds the renderer and Electron bundles with `pnpm run build:vite`
- starts Electron in an isolated E2E mode with a temporary `HOME`
- uses a temporary YYClaw `userData` directory
- skips heavy startup side effects such as gateway auto-start, bundled skill
  installation, tray creation, and CLI auto-install

The first two baseline specs cover:

- first-launch setup wizard visibility on a fresh profile
- skipping setup and navigating to the Models page inside the Electron app

Add future Electron flows under `tests/e2e/` and reuse the shared fixture in
`tests/e2e/fixtures/electron.ts`.
### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 40+ |
| UI Framework | React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Build | Vite + electron-builder |
| Testing | Vitest + Playwright |
| Animation | Framer Motion |
| Icons | Lucide React |

---

## Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or translations—every contribution helps make YYClaw better.

### How to Contribute

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes with clear messages
4. **Push** to your branch
5. **Open** a Pull Request

### Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

## Acknowledgments

YYClaw is built on the shoulders of excellent open-source projects:

- [OpenClaw](https://github.com/OpenClaw) - The AI agent runtime
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
- [React](https://react.dev/) - UI component library
- [shadcn/ui](https://ui.shadcn.com/) - Beautifully designed components
- [Zustand](https://github.com/pmndrs/zustand) - Lightweight state management

## Community

Join our community to connect with other users, get support, and share your experiences.

| Enterprise WeChat | Feishu Group | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QR Code" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QR Code" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QR Code" /> |

### YYClaw Partner Program 🚀

We're launching the YYClaw Partner Program and looking for partners who can help introduce YYClaw to more clients, especially those with custom AI agent or automation needs.

Partners help connect us with potential users and projects, while the YYClaw team provides full technical support, customization, and integration.

If you work with clients interested in AI tools or automation, we'd love to collaborate.

DM us or email [public@valuecell.ai](mailto:public@valuecell.ai) to learn more.

## Star History

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/YYClaw&type=Date" alt="Star History Chart" />
</p>

## License

YYClaw is released under the [MIT License](LICENSE). You're free to use, modify, and distribute this software.

<hr>

<p align="center">
  <sub>Built with ❤️ by the ValueCell Team</sub>
</p>
