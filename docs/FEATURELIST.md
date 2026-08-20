# Feature and Bug List -- YYClaw Desktop Client

This is the working index of **what ships today** and **what is currently open**.
`AGENTS.md` Startup Rule 6 points here to decide what to work on next.

It is maintained by hand. Treat it as a pointer, not as generated truth:

- **Authoritative feature behavior** lives in [`PRODUCT.md`](PRODUCT.md) (per-feature
  route, capabilities, constraints).
- **Authoritative architecture and invariants** live in
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- **User-facing detail** lives in [`en-US/features.md`](en-US/features.md) and its
  localized siblings.
- **Quality gates and environment traps** live in
  [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

When you add, change, or remove a feature, update this table **and** the matching
`PRODUCT.md` section in the same change.

---

## Shipped Features

Statuses: **GA** = generally available · **Dev-gated** = only visible with Developer
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
| 13 | System Settings | System Settings modal | GA | General / Gateway / Voice / Update / Developer |
| 14 | System Integration | App shell / tray | GA | Single-instance, tray, autostart, auto-update |
| 15 | Gateway Lifecycle & Reliability | Background | GA | Supervision, health, port-conflict resolution |
| 16 | Theming & Localization | Global | GA | Light/dark/system; `en` / `zh` / `ja` / `ru` |

## Known Open Items

Carried over from the working notes in [`../TODO.md`](../TODO.md). These are not yet
tracked as GitHub issues.

| # | Item | Area | Notes |
|---|------|------|-------|
| 1 | Deploy the anonymous telemetry collection server privately on `aiserver` and enable the related features | Telemetry / infra | `telemetryUploadEnabled` is currently `false` in `package.json` |
| 2 | Feishu client login, after which granting individual permissions is no longer required | Channels / auth | Reduces per-permission setup during Feishu onboarding |
| 3 | Setting a variable in a skill does not take effect immediately | Skills | Suspected caching / reload gap on the skill config path |

## Documentation Debt

| Item | Notes |
|------|-------|
| Screenshots are generated with seeded mock data | `pnpm run screenshots` captures all 24 images from an isolated profile with mocked gateway/provider/skill/cron/channel data and a seeded chat conversation (`tests/e2e/capture-readme-screenshots.spec.ts`). The data is representative, not real. Re-run after any UI change that affects the six README surfaces |
| Seeded content is layout-sensitive | The chat conversation is tuned to fit the 1280×800 viewport without scrolling. Lengthening the prose, or a locale that wraps to an extra line, pushes the user's request out of frame — check every locale after editing `CHAT_CONTENT`. Avoid `$…$` pairs in seeded prose: the renderer treats them as KaTeX inline math (by design) |
| No screenshots for several shipping pages | Setup wizard, Agents, Workflows, Image Generation, and the Memory tab have no screenshot in any locale |
| Screenshot locale directories are inconsistently named | `resources/screenshot/{en,zh,jp,ru}` vs `docs/{en-US,zh-CN,ja-JP,ru-RU}` |
| `tests/unit` is not typechecked | `tsconfig.test.json` covers only `tests/e2e/fixtures` (the shared harness). Extending it to every spec surfaces ~350 pre-existing loose-typing errors (inferred literals vs. declared mock shapes, missing vitest globals) that need cleanup first |
| `docs/yyclaw-multi-agent-design.md` has malformed diagrams | 32 ASCII box lines have inconsistent widths and the file has an odd number of code fences (41) |

## How to Extend This List

1. Add the feature row above with its entry point and status.
2. Add the full feature section to [`PRODUCT.md`](PRODUCT.md) using the template in
   its *Extending This Document* section.
3. Add user-facing detail to `docs/<locale>/features.md` for all four locales.
4. Route new user-facing strings through `react-i18next` with full locale coverage.
5. Add or update a Playwright E2E spec covering the new interaction.
6. If the change touches communication paths, start from a task spec under
   `harness/specs/tasks/` and run `pnpm run comms:replay` + `pnpm run comms:compare`.
