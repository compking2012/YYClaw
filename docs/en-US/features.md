# YYClaw Features

## Product Vision and Target Scope

YYClaw aims to be an **open-source, vendor-neutral, cross-platform AI workbench** with controlled privacy and cost, reliable execution, extensibility, and auditability. Its unified Agent runtime connects a full-feature desktop, mobile/tablet console, and persistent user-owned Linux server. Six pillars guide the product: MIT openness, consistent permission-tiered experiences, local–cloud cooperation, native multimodality, deterministic audited automation, and global plus Chinese ecosystem coverage.

Core scenarios cover developers' code/operations, creators' private assets and scheduled publishing, small teams' IM/customer workflows, and researchers' private analysis and batch literature processing. Target capabilities include screen/voice/document/video perception, text/chart/image/speech/video-script outputs, XState workflows with retries/approvals/recovery, isolated Agents, traceable Cron, cloud/local models, MCP, and international tools alongside Feishu/Lark, DingTalk, and WeCom.

**These are product goals, not shipped-feature guarantees.** Mobile, remote-host management, synchronization, placement, and migration are target requirements. Sensitive tasks and local system operations stay local; eligible long tasks may run on authorized cloud hosts. A local Agent calling a cloud model is not device-only processing. See the [full PRD](../PRODUCT.md) and [delivery status](../FEATURELIST.md); below is the current desktop feature guide.

Candidate slogan: *One Workbench, All Devices, Any Model.*

The developer-gated standalone Image Generation sidebar page is retained. It shares the integrated upstream endpoint settings with the local developer settings; model management remains in the local Settings modal rather than moving image generation into an upstream Models tab.

The local provider catalog adds TokenDance browser authorization and API-key setup with upstream Chinese-language discovery and request attribution. Anthropic and Google use upstream connection presets. Existing local model IDs, defaults, and multi-model capability slots remain unchanged; the remote/local catalog selection and developer fallback are retained.

This document is the detailed companion to the Features section in the
[README](../../README.md). It keeps the implementation caveats, limits, and
configuration mechanics that are too granular for the README itself.


### Upstream Integration

The composer keeps local account names and conversation-only model selection. ACP context usage appears before Gateway status; fresh runtime totals remain authoritative. Compaction status and read-only native subagent drill-down coexist with the independent local workflow timeline. Switching with `@agent` starts a fresh target-agent conversation.

Only changing the global default conversation model recalculates the compaction reserve floor (25% of explicit context metadata, otherwise 50,000 tokens). Per-agent overrides, media slots and startup synchronization do not recalculate it. Explicit compaction settings remain preserved.

DingTalk uses the upstream official connector while retaining local multi-account support and optional workspace authorization. Computer Use follows the upstream local driver lifecycle and permissions. Settings → About exports redacted diagnostics and optionally selected raw conversation transcripts to a local ZIP; no automatic upload occurs.

## Zero Configuration Barrier

Complete the entire setup from installation to your first AI conversation through
an intuitive graphical interface. No terminal commands, YAML files, or
environment-variable hunting are required.

The first-launch wizard covers **Language & Region** (preselecting the system
language when supported, English otherwise), **AI Provider** (API key, or
browser/device OAuth where the provider supports it), **Skill Bundles**, and a
**Verification** step. Completing it sets a persisted "setup complete" flag and
redirects to Chat. The wizard can be skipped, the UI is fully navigable without
provider keys, and Gateway readiness is not required to complete setup.

## Intelligent Chat Interface

Communicate with AI agents through a modern chat experience. YYClaw supports
multiple conversation contexts and message history, with assistant replies
rendered as streaming Markdown with syntax-highlighted fenced code, CJK-aware
parsing, GitHub-flavored tables, and KaTeX-powered LaTeX math (`$inline$`,
`$$block$$`, `\(inline\)`, and `\[block\]`). User input remains literal text. The
main composer also supports direct `@agent` routing for multi-agent setups. Fenced
code preserves source line breaks, soft-wraps long lines, and provides a localized
copy action after streaming completes.

Skills inserted from the composer appear as `/skill-name` cards. Click a card to
open the preview sidebar and read that skill's `SKILL.md`.

When you target another agent with `@agent`, YYClaw switches directly to that
agent's own conversation context instead of relaying through the default agent.
Agent workspaces stay separate by default, while stronger runtime isolation
depends on OpenClaw sandbox settings.

The composer also includes a **Model** picker when multiple configured models are
available. Model changes are applied by OpenClaw's native config watcher without
restarting the Gateway; YYClaw waits for the live `agents.list` snapshot to expose
the selected model before allowing the next send. Skills are scoped per agent
(`agents.list[].skills`): creating or editing an agent lets you choose that
agent's enabled skills, and legacy global skill toggles are migrated to each
existing agent once for backward compatibility.

### Session Sidebar

The session sidebar is workspace-first: the default workspace stays at the top,
other workspaces sort naturally, and each workspace can collapse or load more
sessions. A session row shows a spinner while the AI is replying, a blue dot when
an unseen reply finishes, and its relative activity time after the conversation is
opened; hovering still reveals row actions. Imported workspaces can be renamed
from their sidebar header. The custom name is reflected in the chat composer,
while hovering the header still reveals the filesystem path.

When a valid workspace is selected, a new chat inherits it while remaining
editable until the first send. Editable new or unbound chats expose a workspace
chip in the composer. Its menu lists recent and known-session workspaces, lets you
return to the default workspace, or choose another folder. If a saved workspace
folder was moved or deleted, Chat pauses session creation and asks you to choose an
existing folder instead of repeatedly retrying the missing path. Unavailable
non-default groups are marked in the sidebar and can be removed after
confirmation; this permanently deletes every session in that group. A session row
is removed and navigation changes only after permanent deletion succeeds. Failed
deletions leave the conversation and confirmation open for retry.

Synthetic OpenClaw UUID-date fallback titles are treated as missing only when they
match the session ID, then replaced with the conversation's first user prompt
instead of being persisted as the session name.

On a cold start or after a Gateway restart — when you have not opened a specific
conversation yet — Chat lands on a brand-new empty conversation rather than
resurrecting the most recently updated session; existing sessions stay listed in
the sidebar.

### Document Previews

The Workspace and Preview tabs in Chat's right panel provide read-only previews
for Markdown, `.docx`, and `.pptx` files. Markdown previews use the same
syntax-highlighted, soft-wrapped, copyable fenced code, CJK-aware parsing, and
KaTeX math support in static rendering mode. The Preview header can expand the
selected file to the full YYClaw viewport; use the same control or press Escape to
return to the panel.

Limits: legacy `.doc` and `.ppt` files open through the operating system instead
of inline; DOCX pagination may differ from Microsoft Word; PPTX previews do not
support animations, transitions, or media playback; Office files larger than
20 MB are not previewed inline.

## Local HTML Preview

The Chat right panel contains Workspace, Preview, and Changes tabs. It does not
provide a general web browser, home page, or address bar. Authorized local `.html`
and `.htm` attachments, file activities, and Workspace files open in Preview by
default. File actions let you choose the built-in Preview or a system application,
and the Preview header can open the current HTML file in the system browser.

All links are non-clickable. Links rendered by YYClaw appear as ordinary text, and
links inside HTML Preview have their styling and pointer interaction removed. HTML
Preview also blocks forms, script navigation, redirects, hash navigation, popups,
downloads, network requests, and device permissions. It can render self-contained
local HTML but cannot leave the selected document.

## Voice Interaction

Talk to your agents and hear them reply. Voice runs entirely through the OpenClaw
kernel's native Talk/TTS Gateway RPCs — no extra services.

- **Voice input** uses OpenClaw **Talk mode**. *Dictation* (push-to-talk)
  transcribes your speech into the composer for review before sending;
  *Conversation* mode opens a continuous hands-free dialog (listen → think →
  speak) with server-side voice activity detection and barge-in. Switch modes in
  **Settings → Voice**.
- **Voice output (TTS)**: each assistant reply has a 🔊 play button, and
  **Settings → Voice → Auto-read** can read final replies aloud automatically.
- Microphone access prompts on first use; on macOS the app requests the system
  microphone permission.

### Voice Model Configuration

Voice models are listed alongside chat providers on the **Models** page. Provider
definitions come from the remote provider catalog when it is reachable, falling
back to the bundled `resources/config/providers.json` otherwise (the two are
either/or, not merged) — so which capability types are offered, including `tts` /
`transcription` / `realtime`, depends on that source.

Configure the provider's API key, model, and base URL; selections are written to
the OpenClaw config (`messages.tts` and the `voice-call` plugin). This release
supports two built-in voice runtimes, **OpenAI** and **MiniMax**, selected via the
provider's `voiceRuntimeProviderId`. Voice parameters (voice, audio format, speed,
and so on) are built into those runtimes and are not user-configurable for now: a
voice-capable provider only needs to declare its voice model id, and saving the
account — or switching it to be the default provider — bridges those kinds into
the same OpenClaw voice config sections.

Deleting a voice provider, or turning off speech synthesis in the Agents **Global
Config**, removes the related entries from those voice config sections again,
promoting another configured provider as the default when one is still available.

Caveats:

- OpenAI TTS honors the base URL, but the kernel's realtime transcription endpoint
  is fixed to `api.openai.com` (the base URL is not yet applied there).
- Realtime voice requires a kernel capability plugin matching the voice provider
  id.
- Anthropic Claude has no speech models — use Claude as the chat brain with
  another provider's TTS/ASR.
- Voice is strictly config-gated: when `messages.tts` or the transcription
  provider are not set in the config, the corresponding UI controls (the 🔊 play
  button and the 🎙️ record button) are disabled and the desktop refuses
  TTS/transcription calls. There is no built-in default fallback.

## Multi-Agent Management

Create and configure multiple agents, each with its own model, enabled skills, and
channel binding:

- Per-agent **model override** (`provider/model`); agents without an override
  inherit the global default model.
- Per-agent **skill allowlist** (`agents.list[].skills`) chosen when creating or
  editing an agent.
- **Channel binding** — each agent card has a **Bind Channels** button that opens a
  modal for binding multiple channel accounts to that agent at once. Each account
  is handled by one agent at a time.
- **Global Config** — default model selection and global toggles such as the speech
  synthesis enable switch.

## Multi-Channel Management

Configure and monitor multiple AI channels simultaneously. Each channel operates
independently, allowing you to run specialized agents for different tasks.

Each channel supports multiple accounts, per-account agent binding, and switching
the channel default account directly from the Channels page. Live connection
status is shown per account.

For custom channel account IDs, YYClaw enforces OpenClaw-compatible canonical IDs:
`[a-z0-9_-]`, lowercase, a maximum of 64 characters, and starting with a letter or
number. This prevents routing mismatches.

YYClaw bundles Tencent's official personal WeChat channel plugin, so you can link
WeChat directly from the Channels page through an in-app QR flow. Additional
bundled channel plugins cover Feishu/Lark, WeCom, Discord, QQ, and WhatsApp.

One-click Feishu app creation also auto-configures a **Quick Commands** bot menu
(`/new`, `/stop`, `/reset`, `/status`, `/compact`) so users can drive OpenClaw
session control by tapping the bot menu instead of typing.

## Cron-Based Automation

Schedule AI tasks to run automatically. Define triggers and set intervals so AI
agents can work around the clock.

The Cron page lets you configure external delivery directly in the task form with
separate sender-account and recipient-target selectors. For supported channels,
recipient targets are discovered automatically from channel directories or known
session history, so you no longer need to edit `jobs.json` by hand. The task
message field supports inserting skills with the same inline `/skill` token syntax
as the main chat composer, scoped to the selected agent, so scheduled prompts can
trigger skills directly.

The schedule picker is split into **Recurring** and **Once** tabs. Recurring offers
Hourly, Daily, Weekdays, Weekly, and Custom raw cron frequencies with inline time
and weekday controls. Once runs the task a single time at a chosen date, with the
weekday shown, and time. One-time tasks must be scheduled for a future moment and
are automatically removed by the runtime once they finish.

On upgrade to a SQLite-backed runtime, YYClaw silently re-creates any recoverable
user jobs from legacy `jobs.json` / `jobs.json.bak` into the new store on first
launch and archives the originals under `~/.openclaw/cron/legacy-archive/`.
`[managed-by=...]` internal jobs are left for the runtime to rebuild.

## Deterministic Workflow Engine

For tasks with clearly defined steps, the **Workflows** page runs a deterministic
orchestration engine (XState v5) in the main process. Control flow — which node
runs, which branch is taken, which loop repeats — is 100% fixed; only nodes
explicitly marked as *model* (or *agent*) steps carry non-determinism, and that is
constrained with a schema (`temperature=0` plus zod validation and bounded
retries) and can fall back to a deterministic path.

Each run produces a per-node trace that labels every step as **deterministic** or
**model**. Runs are persisted as versioned JSON snapshots under
`userData/workflows/`, so a crash resumes without re-running completed steps, and
live progress streams to the UI over the `workflow:progress` event channel.

The engine drives OpenClaw rather than the reverse: deterministic steps run as
plain main-process functions, while a single constrained model step talks to the
configured provider directly, bypassing the agent loop.

When a chat task is auto-routed to a workflow, it appears **inline in the
conversation** as a process message. The query bubble shows immediately and the
composer reuses the same *thinking* indicator a normal turn shows while the server
decomposes the task (the workflow card's compact link stays hidden during this
window). Once the plan resolves, the card's link appears in place and its floating
progress popover opens automatically; you can click the card to reopen the popover
or click away to dismiss. Each node runs as a child sub-session of the main
conversation rather than a separate top-level session, and on completion a final
synthesized reply is posted back into the conversation.

## Extensible Skill System

Extend your AI agents with pre-built skills. The integrated Skills page is
local-first: it scans the managed directory plus bundled, extension, and plugin
skills, while workspace, `.agents`, and `skills.load.extraDirs` are excluded to
prevent duplicate versions. You can enable or disable skills without depending on
the Gateway — no package managers required.

The Skills page shows each skill's actual location so you can open the real folder
directly. Installing a managed skill with the same metadata name or slug asks for
confirmation; confirmed replacement is transactional, so a failed install restores
the previous copy.

### Bundled Skills

YYClaw pre-bundles full document-processing skills (`pdf`, `xlsx`, `docx`, `pptx`)
from [`anthropics/skills`](https://github.com/anthropics/skills), plus a curated
catalog (GitHub, tmux, Notion, Obsidian, Trello, weather, and more) vendored at
build time via the standalone `skills` CLI (`npx skills add …`, independent of the
OpenClaw CLI). All are deployed automatically to the managed skills directory
(default `~/.openclaw/skills`) on startup and enabled by default on first install.
Platform-restricted skills, such as the Apple ones, are only deployed on macOS.

Some bundled search skills need API keys (for example `TAVILY_API_KEY`,
`BOCHA_API_KEY`); missing keys surface as OpenClaw runtime configuration errors.

### Server Marketplace

A single **`farmApiBaseUrl`** in the root `package.json` (scheme, host, and port
only, e.g. `http://aiserver.example.com:9001`) drives the server-backed features.
The app loads the AI provider catalog from `GET /api/v1/provider-catalog` on that
base, and the **Install Skills** side panel (server source) uses the same base for
`GET /api/v1/skill_list` (browse), `GET /api/v1/skill_search?q=` (filter), and
`GET /api/v1/skill_file/:name` (install zip). An optional
`Authorization: Bearer` header uses the Farm auth token from app settings when set.

Installing a server-marketplace skill first validates the ZIP's actual skill
identity before any same-name replacement confirmation.

## Secure Provider Integration

Connect to multiple AI providers, including OpenAI, Anthropic, and Z.AI / GLM,
with credentials stored securely in the native system keychain. OpenAI supports
both API keys and browser OAuth for Codex subscriptions.

For **Custom** providers used with OpenAI-compatible gateways, you can set a
custom `User-Agent` in **Settings → AI Providers → Edit Provider** for
compatibility-sensitive endpoints.

When you edit or switch providers, YYClaw preserves existing per-model capability
metadata such as `input: ["text", "image"]`. Newly selected Custom-provider models
use OpenClaw onboarding-compatible image-input inference, with unknown models
defaulting to text-only.

Custom-provider model rows also receive an explicit `contextWindow`, inferred from
the model family (for example `gpt-5.x` → 272k). Rows saved by older versions are
backfilled on startup so OpenClaw can compact long sessions before they fail with
"Context overflow" errors. When no compaction configuration exists, YYClaw seeds
`agents.defaults.compaction.mode = "safeguard"` and `reserveTokensFloor = 50000`;
rows or configurations you authored yourself are never modified, except that a
missing `reserveTokensFloor` may be backfilled.

Z.AI (CN / Global) maps to OpenClaw's built-in `zai` provider (`ZAI_API_KEY`). The
default model is `glm-5.2`. Use the Code Plan preset for Coding Plan endpoints
(`…/api/coding/paas/v4`) or the normal API endpoints (`…/api/paas/v4`). CN and
Global are mutually exclusive because they share one OpenClaw runtime key.

When a compatible gateway rejects `/models` for non-authentication reasons, YYClaw
automatically falls back to a lightweight `/chat/completions` or `/responses`
probe using the configured model during API-key validation.

> Note for Moonshot (Kimi): YYClaw keeps Kimi web search enabled by default. When
> Moonshot is configured, YYClaw also syncs Kimi web search to the China endpoint
> (`https://api.moonshot.cn/v1`) in the OpenClaw config.

### Token Usage Analytics

The Models page charts token usage over relative rolling 7-day and 30-day windows
(not calendar-month buckets), grouped by model or by time, with cache-hit-rate
computation and per-entry detail. When grouped by time, the chart keeps all day
buckets in the selected window; only model grouping is intentionally capped to the
top entries.

Token-usage history is aggregated from OpenClaw session transcript `.jsonl` files
under the local OpenClaw config directory, not parsed from console logs. It scans
both configured agents and any runtime agent directories found on disk, and treats
normal, `.deleted.jsonl`, and `.jsonl.reset.*` transcripts as valid history
sources, extracting assistant/tool usage records that carry `message.usage`. Reads
use an mtime/size-keyed incremental cache so a large sessions directory does not
trigger repeated full-file rescans on the main process.

## Image Generation

In developer mode, the dedicated **Image Generation** page supports an independent
OpenAI-compatible image-generation endpoint (Base URL, API key, and model name
such as `gpt-image-2`) so image generation can use a dedicated
`/v1/images/generations` service while chat continues using the normal OpenAI
provider.

Natural-language image generation in Chat does not need that developer page. Give
any provider account an `image_generate` model kind in **Settings → AI Providers**
and its own provider key (e.g. `gptimage2-gptimage/gpt-image-2`) works directly.
YYClaw's two bundled image plugins self-detect from `openclaw.json` which provider
keys host their own model family (`gpt-image-*` / `dall-e-*` for
`clawx-openai-image`, `gemini-*-image` for `clawx-gemini-image`) and register those
keys as aliases, so no new `models.providers` entry is created and no API key is
copied.

This exists because OpenClaw only resolves image generation against providers
registered in its image-generation registry — a plain `models.providers` entry
never qualifies on its own. The model id already fixed in
`imageGenerationModel.primary` decides the wire protocol, so nothing is probed at
request time; a model in neither family (for example minimax `image-01` or Google
`imagen-*`) is left to OpenClaw's own built-in providers.

The split between the two plugins is required, not cosmetic: OpenAI-compatible
relays reject non-imagen Gemini models on `/v1/images/generations`, and OpenClaw's
built-in `google` image provider pins its base URL to
`generativelanguage.googleapis.com`, so it cannot serve a relay. YYClaw's prelaunch
step also sets `agents.defaults.mediaGenerationAutoProviderFallback = false`
whenever either plugin is needed, so a model the relay cannot generate fails with
the relay's own error instead of silently rendering through another authenticated
provider.

## OpenClaw Dreams

The **Memory** tab in System Settings manages OpenClaw `memory-core` dreaming —
background memory consolidation — covering status, diary, maintenance, and
enable/disable. Requires a running Gateway and the dreaming plugin configuration
on the OpenClaw side.

## Adaptive Theming

Choose light mode, dark mode, or a system-synchronized theme. YYClaw adapts to
your preferences automatically, on a warm palette with all user-facing strings
routed through `react-i18next` across `en`, `zh`, `ja`, and `ru`.

## Startup Launch Control

In **Settings → General**, enable **Launch at system startup** so YYClaw starts
automatically after login.

## Update Prompts

YYClaw checks for new versions on startup. When an update is available, it shows
an in-app prompt; downloading and installing happen only after you choose the
action.

**macOS:** for in-app updates (automatic or when you choose **Install and
restart**), copy YYClaw into **/Applications** from the DMG and run it from there.
If you launch the app directly from the mounted DMG or another read-only volume,
the updater may be unable to replace the app bundle and the install step can
appear to do nothing.

### For maintainers

The main process checks the generic-provider feed under `{CDN}/{channel}/`, where
the channel follows the app semver (stable → `latest`). To **force** users to
upgrade, publish `forceUpdate: true` at the **root** of the channel's `*-mac.yml`
/ `*.yml` so `electron-updater` passes it through to the UI. The channel directory
must match the app's prerelease tag, or stable builds will read the wrong manifest.

## Session Maintenance

In **Settings → Advanced** with Developer Mode enabled, a **Session Auto-cleanup
Policy** form writes `session.maintenance` (mode / pruneAfter / maxEntries /
maxDiskBytes) into `openclaw.json` so the Gateway prunes old or over-budget
sessions on its own schedule. `mode` defaults to `enforce` and is seeded
automatically on startup if unset. Session transcripts under
`~/.openclaw/agents/*/sessions/` are append-only and can reach several GB.

## Configuration Storage

All configuration files (including `openclaw.json` and `auth-profiles.json`) are
written as **plain text** on disk for both development and production builds. This
mitigates conflicts with OpenClaw's upstream config-health observe mechanism, which
may generate `.clobbered` backup files if parsing or size changes unexpectedly.
Reading of historical encrypted configs (`CLAWX_ENCRYPTED_v1:`) is still supported.
