---
id: docs-sync
title: Docs Sync
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
---

## Document Layer Contract

Source: [documentation ownership](../../../docs/DOCUMENTATION.md), [requirement breakdown](../../../docs/FEATURELIST.md), and [harness workflow](../../README.md).

- Root READMEs and all four localized guide directories are introductions to implemented scope only. Do not add planned features or target architecture, even with a disclaimer.
- PRODUCT is the PRD; FEATURELIST decomposes its complete requirements into stable IDs, delivery evidence and backlog; ARCHITECTURE derives technical design and describes key implementations. These root development documents may contain explicit TODO/PARTIAL design and do not require translations.
- Harness scenarios, rules and bounded tasks derive from FEATURELIST and may specify pending implementation. Declare feature association, acceptance and validation; references remain non-executable.
- Functional or architecture changes must declare docs.required and explicitly decide whether introduction translations are required. Implemented behavior changes update all affected READMEs/guides across en-US, zh-CN, ja-JP and ru-RU. Target-only design changes update development docs/harness without introducing public delivery claims.
- Promote only the verified implemented subset of a PARTIAL feature; preserve developer-mode gates and configuration prerequisites. Specs and dry-run success are not evidence of full delivery.
- Do not link tracked documents to the local-only multi-Agent collaboration draft.
