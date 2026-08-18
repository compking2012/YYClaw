---
id: clawx-image-self-detecting-provider
title: Self-detecting ClawX image plugins pick up account provider keys directly
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Let natural-language image generation work for custom relay models by having two ClawX image-generation plugins self-detect, from OpenClaw config alone, which `models.providers` keys host their model family and register those keys as `aliases` — so an account's own `imageGenerationModel` ref (e.g. `gptimage2-gptimage/gpt-image-2`) resolves directly, without ClawX creating any provider entry, copying any key, or rewriting the ref.
touchedAreas:
  - harness/specs/tasks/clawx-image-self-detecting-provider.md
  - harness/specs/scenarios/plugin-lifecycle-management.md
  - resources/openclaw-plugins/clawx-openai-image/package.json
  - resources/openclaw-plugins/clawx-openai-image/openclaw.plugin.json
  - resources/openclaw-plugins/clawx-openai-image/index.mjs
  - resources/openclaw-plugins/clawx-gemini-image/package.json
  - resources/openclaw-plugins/clawx-gemini-image/openclaw.plugin.json
  - resources/openclaw-plugins/clawx-gemini-image/index.mjs
  - electron/utils/openclaw-image-relay-constants.ts
  - electron/utils/provider-keys.ts
  - electron/utils/openclaw-image-generation.ts
  - electron/utils/plugin-install.ts
  - electron/gateway/config-sync.ts
  - electron/gateway/image-generation-plugin-resolution.ts
  - shared/i18n/locales/en/dashboard.json
  - shared/i18n/locales/zh/dashboard.json
  - shared/i18n/locales/ja/dashboard.json
  - shared/i18n/locales/ru/dashboard.json
  - tests/unit/clawx-openai-image-plugin.test.ts
  - tests/unit/clawx-gemini-image-plugin.test.ts
  - tests/unit/image-generation-plugin-resolution.test.ts
  - tests/unit/image-generation-plugin-config.test.ts
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - After adding a custom AI provider whose model declares the `image_generate` kind, natural-language image requests in Chat produce an image without any developer-mode configuration and without ClawX writing a new `models.providers` entry.
  - `agents.defaults.imageGenerationModel.primary` keeps naming the account's own provider key (e.g. `gptimage2-gptimage/gpt-image-2`); ClawX never rewrites it to a plugin-owned key.
  - A `gpt-image-*` / `dall-e-*` model reaches the relay through the OpenAI Images endpoint; a model whose id contains both `gemini` and `image` reaches it through the Gemini `generateContent` endpoint. Which plugin runs is fully determined by the model id already fixed in the ref — nothing is probed.
  - A model belonging to neither family (minimax `image-01`, Google `imagen-*`, …) is left to OpenClaw's own built-in image providers; ClawX plugins do not claim it.
  - A model the relay cannot generate images for fails with the relay's own error message; ClawX never silently substitutes another authenticated image provider such as `minimax-portal/image-01`.
  - Gemini image refusals surface the upstream finish reason instead of a generic "missing image data" message.
  - Renderer keeps using host-api and does not call Gateway HTTP directly.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - renderer-main-boundary
  - backend-communication-boundary
  - provider-default-invariant
  - provider-model-selection-authority
  - provider-model-metadata-preservation
  - capability-owner-resolution
  - channel-plugin-migration-guards
  - active-config-guards
  - comms-regression
  - docs-sync
requiredTests:
  - pnpm exec vitest run tests/unit/clawx-openai-image-plugin.test.ts tests/unit/clawx-gemini-image-plugin.test.ts tests/unit/image-generation-plugin-resolution.test.ts tests/unit/image-generation-plugin-config.test.ts
  - pnpm run typecheck
  - pnpm run comms:replay
  - pnpm run comms:compare
acceptance:
  - Each plugin derives its `aliases` at `register()` time from `api.config.models.providers`, claiming a key only when that key's declared models include one of the plugin's own family (`isOpenAiImageModel` / `isGeminiImageModel`); provider key names are never parsed or hardcoded.
  - Native OpenClaw image-generation provider ids (`openai`, `google`, `minimax`, `minimax-portal`, `litellm`, `comfy`, `fal`, `openrouter`, `vydra`, `xai`, `microsoft-foundry`) are never claimed as aliases, even if their entry happens to list a model matching a ClawX family.
  - The two plugins' claimed-key sets are always disjoint for any given config: a key hosting an OpenAI-family model is never also claimed by the Gemini plugin, and vice versa.
  - `generateImage` resolves `baseUrl` and credentials from `req.cfg.models.providers[req.provider]` and `resolveApiKeyForProvider({ provider: req.provider, ... })` — the literal key OpenClaw passed at request time — so a renamed or regenerated provider key needs no plugin change.
  - ClawX's prelaunch step installs and enables only the plugin(s) actually required by the current `imageGenerationModel` refs (defaults and per-agent), determined by each ref's model id, and never creates a `models.providers` entry or copies an API key.
  - The prelaunch step sets `agents.defaults.mediaGenerationAutoProviderFallback` to `false` whenever at least one ClawX image plugin is required, so an unsupported model fails loudly instead of silently rendering through an unrelated provider.
  - The Gemini plugin posts `generateContent` against a `/v1beta` base URL derived from the resolved provider entry's `baseUrl`, requests `TEXT` and `IMAGE` response modalities, maps size to `imageConfig`, and parses `inlineData` parts.
  - The Gemini plugin reports `finishReason` and `finishMessage` when a response carries no image parts.
  - The OpenAI plugin's request body omits the deprecated `response_format` field and any quality/format/background fields the relay does not require.
  - The default image-generation test prompt does not trip Gemini image recitation filtering.
docs:
  required: true
---

## Background

OpenClaw resolves image generation against a fixed registry of providers that call
`api.registerImageGenerationProvider()`. An account's `models.providers` entry is a chat
provider config and never joins that registry on its own, so a ref like
`gptimage2-gptimage/gpt-image-2` cannot resolve unless something registers
`gptimage2-gptimage` as an image-generation provider — but `gptimage2-gptimage` is a
provider key **generated** by `getOpenClawProviderKeyForType` (`type.slice(0,8)` roughly), so
no plugin can know its name ahead of time, and ClawX must not treat it as a stable identifier
either.

The fix is that each ClawX image plugin inspects `api.config.models.providers` at `register()`
time and finds which keys host a model of *its own family* — OpenAI Images
(`gpt-image-*` / `dall-e-*`) for `clawx-openai-image`, Gemini generateContent
(`gemini-*-image`) for `clawx-gemini-image` — then declares those keys as `aliases`. OpenClaw's
plugin registry resolves a ref's provider by id-or-alias, so the account's own ref now resolves
straight to the plugin. At request time the plugin reads `req.provider` (the literal key
OpenClaw looked up) to find the matching `models.providers` entry and its credentials — the key's
name plays no other role.

Two plugins are required because relays speak two incompatible protocols for image models:
`POST /v1/images/generations` (OpenAI Images) rejects non-imagen Gemini models
("only imagen models are supported"), and OpenClaw's built-in `google` provider pins its base
URL to `generativelanguage.googleapis.com` so it cannot serve a relay either. Which model runs
is already fixed by `imageGenerationModel.primary`, so the model id alone decides the protocol —
nothing is probed at request time.
