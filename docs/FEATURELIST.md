# Feature and TODO List -- YYClaw AI Workbench

This development document is the **complete PRD-derived requirement breakdown** and delivery index, including implemented and unimplemented scope. It is not a release introduction and does not require translation.
`AGENTS.md` Startup Rule 6 points here to decide what to work on next.

It is maintained by hand. Treat it as a pointer, not as generated truth:

- **Product requirements and intended feature behavior** live in [`PRODUCT.md`](PRODUCT.md) (per-feature
  route, capabilities, constraints).
- **Authoritative architecture and invariants** live in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **User-facing detail** lives in [`en-US/features.md`](en-US/features.md) and its
  localized siblings.
- **Quality gates and environment traps** live in
  [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

When requirements change, update this breakdown and the matching PRD and architecture design. When implementation changes, update evidence and delivery status, derive bounded harness tasks, and promote only implemented behavior to localized introductions. See [DOCUMENTATION.md](DOCUMENTATION.md) and the [harness coverage index](../harness/FEATURE-MAP.md).

---

## Shipped Features

All rows in this section are **DONE** for the documented desktop scope, not for
every corresponding PRD ambition. Availability: **GA** = generally available · **Dev-gated** = only visible with Developer
Mode enabled · **Requires setup** = needs external configuration to function.

| # | Feature | Entry | Status | Notes |
|---|---------|-------|--------|-------|
| 1 | First-Launch Setup Wizard | `/setup/*` | GA | Skippable; no Gateway needed |
| 2 | Intelligent Chat | `/` | GA | Needs ≥1 provider key for real chat |
| 3 | Voice Interaction | Chat + `Settings → Voice` | Requires setup | Strictly config-gated; OpenAI / MiniMax runtimes |
| 4 | Multi-Agent Management | `/agents` | GA | Per-agent model, skills, channel binding |
| 5 | AI Providers & Models Dashboard | Models page | GA | Token usage from session transcripts |
| 6 | Multi-Channel Management | Channels page | Requires setup | Per-channel account linking |
| 7 | Skill System | Skills page | GA | Local-first; marketplace optional |
| 8 | Cron Automation | `/cron` | GA | External delivery configurable in-form |
| 9 | Deterministic Workflow Engine | `/workflows` | Dev-gated | XState v5 in Main |
| 10 | Agent Workspace | Chat right panel | GA | Read-only previews |
| 11 | Image Generation (dedicated page) | `/image-generation` | Dev-gated | Natural-language generation in Chat needs no dev page |
| 12 | OpenClaw Dreams (Memory) | System Settings → Memory | Requires setup | Needs the dreaming plugin on the OpenClaw side |
| 13 | System Settings | System Settings modal | GA | General / Gateway / Voice / Computer Use / Update / Developer; Computer Use is always visible and defaults off |
| 14 | System Integration | App shell / tray | GA | Single-instance, tray, autostart, auto-update |
| 15 | Gateway Lifecycle & Reliability | Background | GA | Supervision, health, port-conflict resolution |
| 16 | Theming & Localization | Global | GA | Light/dark/system; `en` / `zh` / `ja` / `ru` |

## PRD Feature Breakdown and Delivery Status

Source: [PRODUCT.md](PRODUCT.md), especially *Product Vision and Scope*,
*Target Architecture Capabilities*, *Target Users and Core Scenarios*, and
*Core Features*. Architecture counterparts use the same IDs in
[ARCHITECTURE.md](ARCHITECTURE.md#prd-architecture-support-matrix).

**DONE** = implemented within the stated scope; **PARTIAL** = implemented
foundation with remaining **TODO** work; **TODO** = target not delivered as an
integrated YYClaw capability. Setup requirements and developer gating do not mean
the implementation is absent. Status is based on repository code and documented
behavior, not a fresh production certification. Aspirations such as “globally
leading” and “optimal cost” are goals, not completed features. IDs are stable
tracking references, not delivery order or release commitments.

### Openness, Platforms, and Runtime

| ID | Feature | Status | Implemented scope / evidence | TODO Items / completion boundary |
|----|---------|--------|------------------------------|----------------------------------|
| F01 | Open-source neutrality and private customization | DONE | MIT project; OpenClaw runtime; configurable providers and self-hosted catalog/marketplace | Remote Agent hosting is tracked separately in F07 |
| F02 | Mainstream cloud-model compatibility | PARTIAL | Provider catalog, credentials, OpenAI-compatible custom endpoints; `electron/services/providers/`, `electron/utils/provider-registry.ts` | Verify the complete PRD provider/model/capability matrix; do not interpret configurable endpoints as universal compatibility |
| F03 | Local-model support | PARTIAL | Ollama provider configuration in `resources/config/providers.json` | First-class Llama.cpp setup, local runtime lifecycle/capability verification, and device-only task validation |
| F04 | Desktop flagship | PARTIAL | Electron desktop for macOS/Windows/Linux; local Gateway, files and runtime tools | Validate exact Windows 10/11, macOS 11+, Ubuntu 20.04+/Debian/Fedora target ranges and peripheral/platform parity; OS permissions remain mandatory |
| F05 | Local computer/system execution | PARTIAL | Runtime file/Shell tools; opt-in Computer Use service with permission checks, default off; `electron/services/computer-use-api.ts` | Complete cross-platform screen/process/peripheral coverage and capability-level authorization; local opt-in is not the global placement/privacy policy |
| F06 | Mobile/tablet portable console | TODO | No integrated mobile client delivery established | iOS/iPadOS/Android/HarmonyOS chat, voice/camera/upload, remote dispatch, monitoring, notifications and light inference; remove unrestricted system execution |
| F07 | Persistent server/cloud-host mode | PARTIAL | OpenClaw runtime and Electron-free workflow kernel/headless adapter are foundations | Standalone YYClaw Linux/container service, host enrollment/lifecycle, 24/7 operation and desktop/mobile administration; headless adapter alone is not a deployed service |
| F08 | Unified platform schemas and capability tiers | PARTIAL | Desktop Agent/workflow/config types and Host API boundaries | Versioned cross-platform contracts, OS-specific capability discovery/denial and consistent mobile/server configuration |
| F09 | Multi-user/workspace isolation | PARTIAL | Per-Agent workspaces and admin-console shared-workspace integration | Server tenant authorization, user/workspace isolation and enforcement tests; directory separation alone is not a security sandbox |

### Local–Cloud Cooperation, Privacy, and Recovery

| ID | Feature | Status | Implemented scope / evidence | TODO Items / completion boundary |
|----|---------|--------|------------------------------|----------------------------------|
| F10 | Cross-device configuration/data synchronization | PARTIAL | Admin-console remote Agent/model/skill operations and scoped shared-workspace sync; `electron/services/admin-console/remote-sync/`, `office-shared-workspace.ts` | Generalized authorized synchronization of configuration, memory, skills, workflow definitions and task state; conflict/version handling; exclude private data |
| F11 | Manual execution-node selection and remote control | PARTIAL | Admin-console remote session send/list/history/status contracts in `session-send-remote.ts` | Unified desktop/mobile local–cloud node selector, host readiness and capability/privacy checks; remote message delivery is not task migration |
| F12 | Intelligent placement policy | TODO | Local execution and provider selection exist independently | Hard local permission/privacy constraints; >30-minute eligible automation preference; local/cloud compute preferences; user overrides only within policy; safe behavior without eligible hosts |
| F13 | Sensitive-task locality and selective cloud data access | PARTIAL | Local files/config and secure credential storage; Computer Use opt-in | Task/data classification, model/tool egress enforcement, explicit sync scopes, log/snapshot redaction and server access denial; local Agent plus cloud inference is not device-only |
| F14 | Local workflow checkpoints and recovery | DONE | Versioned JSON snapshots, rehydrate/resume/retry and completed-step preservation; `electron/workflow/engine.ts`, `snapshot-store.ts` | Cross-host portability and external side-effect guarantees remain F15/F16 |
| F15 | One-click local–cloud migration | TODO | F14 provides local checkpoint foundation | Portable events/snapshots, compatible nodes, safe checkpoint transfer, single execution ownership and side-effect deduplication; reject local-only tasks |
| F16 | Sleep/shutdown handoff and wake reconciliation | TODO | Local startup rehydration is not cloud handoff | Planned-sleep/shutdown eligible-task transfer, result/state sync on wake, last-durable-checkpoint recovery after abrupt loss |

### Multimodal Interaction and Artifacts

| ID | Feature | Status | Implemented scope / evidence | TODO Items / completion boundary |
|----|---------|--------|------------------------------|----------------------------------|
| F17 | Text/image chat and structured artifacts | DONE | Chat Markdown/LaTeX, images/attachments, streaming and workspace previews; PRODUCT Core Features 2/10 | Broader modality guarantees are separate below |
| F18 | Voice interaction and speech output | DONE | Config-gated dictation/conversation and TTS; `electron/services/asr-api.ts`, `voice-api.ts` | Local/cloud automatic processing policy remains F22 |
| F19 | Screen perception and authorized computer control | PARTIAL | Computer Use runtime/settings and screenshot/image input foundations | Integrated screen-understanding capability matrix across supported desktop OSes and permission states |
| F20 | Deep PDF/Office parsing and chart outputs | PARTIAL | Bundled `pdf`/`docx`/`xlsx`/`pptx` skills, file viewers and generated artifact previews | Native typed layout/chart semantic pipeline and end-to-end chart generation/validation; previews/skills alone do not guarantee deep understanding |
| F21 | Video-frame understanding and video-script artifacts | TODO | General skills/model extensibility is not an integrated video pipeline | Frame extraction, multimodal routing, timeline/context handling and validated video-script output |
| F22 | Local–cloud multimodal processing | TODO | Configurable voice/image/model services exist | Local OCR/transcription capability selection, privacy-safe cloud escalation and shared typed inputs/outputs |
| F23 | Image generation | DONE | Chat generation and developer-gated dedicated page; PRODUCT Core Feature 11 | Model/provider setup remains required |

### Reliable Automation, Agents, and Ecosystems

| ID | Feature | Status | Implemented scope / evidence | TODO Items / completion boundary |
|----|---------|--------|------------------------------|----------------------------------|
| F24 | Deterministic XState control flow and marked reasoning | DONE | XState v5, explicit model/agent nodes, schema validation, bounded model retries and per-node classification; `electron/workflow/` | Deterministic control flow does not guarantee identical model answers |
| F25 | Production workflow governance | PARTIAL | Local retries/recovery, node traces and progress events | Generic durable human approval, comprehensive task/side-effect audit, bounded production execution and release criteria beyond developer gating |
| F26 | Multi-Agent configuration and concurrent workers | PARTIAL | Agent model/skills/persona/channel/workspace management and Agent workflow adapter | Fully enforced per-Agent permission isolation and complete coordinated parallel execution/production acceptance |
| F27 | Cron scheduling, delivery and history | DONE | Job CRUD, enable/trigger, external delivery and run history; PRODUCT Core Feature 8 | Persistent cloud operation is F07; mobile management is F06 |
| F28 | Memory and skill management | DONE | Local-first install/toggle/discovery, marketplaces and configured OpenClaw Dreams integration | Cross-device memory/skill synchronization is F10; external memory plugin setup required |
| F29 | Global and Chinese messaging integration | PARTIAL | Existing channel account/binding/status flows; Feishu, DingTalk, WeCom, Discord, Telegram, WhatsApp and other configured channels | Validate full PRD connector matrix including Slack and equivalent onboarding/operation coverage; plugins require setup |
| F30 | Office/developer tools and MCP ecosystem | PARTIAL | Skills/plugins, document tools, DingTalk workspace integration and runtime extension points | Verified GitHub/Notion/Jira/Google Workspace connector coverage and comprehensive MCP lifecycle/compatibility; extensibility is not proof of every integration |
| F31 | Multilingual consistent UI | DONE | `en`/`zh`/`ja`/`ru`, themes and shared desktop UI conventions | Cross-platform experience remains F06/F08 |
| F32 | Setup, observability and desktop lifecycle | DONE | Wizard, usage dashboard, settings, Gateway supervision, diagnostics, tray/autostart/update; PRODUCT Core Features 1/5/13–16 | Server/remote observability expansion is F07/F11 |
| F33 | Repository autonomous development and per-task PR cleanup | PARTIAL | Harness CLI planning/run/recovery, frozen contracts, Codex adapter, deterministic acceptance, stacked draft PR publisher and owned worktree cleanup; disposable Git integration tests | Real Codex/GitHub sandbox certification, full cross-platform unattended execution and dedicated external-account acceptance remain deployment gates; Claude adapter is reserved |

## TODO Items — PRD Backlog

Every **PARTIAL** row above has outstanding TODO Items; **TODO** rows have no
integrated delivery yet. This index groups the remaining work without duplicating
the authoritative completion boundaries or implying a priority commitment.

| Area | Feature IDs | Outstanding work |
|------|-------------|------------------|
| Platform delivery | F04–F09 | Compatibility verification, local capabilities, mobile clients, Headless deployment, shared contracts and tenant isolation |
| Model/ecosystem coverage | F02, F03, F29, F30 | Verified cloud/local model and connector matrices, Llama.cpp and MCP/tool integration |
| Local–cloud control and privacy | F10–F13 | Generalized sync, node selection, placement and data/model/tool egress enforcement |
| Migration | F15, F16 | Portable checkpoints/events, ownership/deduplication, sleep/wake handoff and reconciliation |
| Multimodal pipeline | F19–F22 | Screen parity, deep document/charts, video, local OCR/transcription and privacy-safe routing |
| Production automation | F25, F26 | Durable approvals/audit, execution guarantees, enforced Agent isolation and coordinated parallel acceptance |

## Known Open Items

Carried over from the working notes in [`../TODO.md`](../TODO.md). These are not yet
tracked as GitHub issues.

| # | Item | Status | Area | Notes |
|---|------|--------|------|-------|
| 1 | Deploy the anonymous telemetry collection server privately on `aiserver` and enable the related features | TODO | Telemetry / infra | `telemetryUploadEnabled` is currently `false` in `package.json` |
| 2 | Feishu client login, after which granting individual permissions is no longer required | TODO | Channels / auth | Reduces per-permission setup during Feishu onboarding |
| 3 | Setting a variable in a skill does not take effect immediately | TODO | Skills | Suspected caching / reload gap on the skill config path |

## Documentation Debt

| Item | Notes |
|------|-------|
| Screenshots are generated with seeded mock data | `pnpm run screenshots` captures all 24 images from an isolated profile with mocked gateway/provider/skill/cron/channel data and a seeded chat conversation (`tests/e2e/capture-readme-screenshots.spec.ts`). The data is representative, not real. Re-run after any UI change that affects the six README surfaces |
| Seeded content is layout-sensitive | The chat conversation is tuned to fit the 1280×800 viewport without scrolling. Lengthening the prose, or a locale that wraps to an extra line, pushes the user's request out of frame — check every locale after editing `CHAT_CONTENT`. Avoid `$…$` pairs in seeded prose: the renderer treats them as KaTeX inline math (by design) |
| No screenshots for several shipping pages | Setup wizard, Agents, Workflows, Image Generation, and the Memory tab have no screenshot in any locale |
| Screenshot locale directories are inconsistently named | `resources/screenshot/{en,zh,jp,ru}` vs `docs/{en-US,zh-CN,ja-JP,ru-RU}` |
| `tests/unit` is not typechecked | `tsconfig.test.json` covers only `tests/e2e/fixtures` (the shared harness). Extending it to every spec surfaces ~350 pre-existing loose-typing errors (inferred literals vs. declared mock shapes, missing vitest globals) that need cleanup first |

## How to Extend This List

1. Decompose the PRD into stable feature IDs, acceptance boundaries, and status; add a shipped-surface row only for implemented scope.
   Update the matching stable PRD feature ID and its architecture support row;
   use DONE/PARTIAL/TODO separately from GA/developer/setup availability.
2. Add the full feature section to [`PRODUCT.md`](PRODUCT.md) using the template in
   its *Extending This Document* section.
3. Derive a bounded task under `harness/specs/tasks/` from the feature ID, using the [coverage index](../harness/FEATURE-MAP.md); declare rules, evidence, and validation. Add or update a scenario when the behavior needs a new reusable contract.
4. Only after implementation, add user-facing detail to all four localized guides and READMEs where relevant; do not copy TODO requirements or target designs into introductions.
5. Route new user-facing strings through `react-i18next` with full locale coverage.
6. Add or update a Playwright E2E spec covering the new interaction.
7. If the change touches communication paths, start from a task spec under
   `harness/specs/tasks/` and run `pnpm run comms:replay` + `pnpm run comms:compare`.
