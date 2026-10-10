# Documentation Layers and Delivery Workflow

## Ownership

| Layer | Files | Purpose | Allowed content | Language |
|-------|-------|---------|-----------------|----------|
| Introduction | Four root READMEs; docs/{en-US,zh-CN,ja-JP,ru-RU}/{features,architecture,development,proxy-settings}.md | Explain the product, implemented architecture and existing tooling | Implemented scope only, including prerequisites, limits and developer gates | All four locales |
| Product requirements | [PRODUCT.md](PRODUCT.md) | PRD: why, who, intended behavior and scope | Delivered and future requirements, clearly distinguished | Development source; translation not required |
| Requirement breakdown | [FEATURELIST.md](FEATURELIST.md) | Complete PRD decomposition, stable IDs, evidence and remaining acceptance boundaries | DONE, PARTIAL and TODO | Development source; translation not required |
| Technical design | [ARCHITECTURE.md](ARCHITECTURE.md) | PRD-derived layers, contracts, key implementations and proposed solutions | Implemented and target design, explicitly separated | Development source; translation not required |
| Development guidance | This document; [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Authoring policy, environment traps and quality gates | Development instructions | English for reliable agent execution |
| Implementation harness | [../harness/README.md](../harness/README.md), specs and reference | Bounded implementation work, reusable scenarios, rules and validation | Work derived from feature IDs, including not-yet-implemented tasks | English for reliable agent execution |

## Derivation and Sources of Truth

1. PRODUCT defines user needs and product scope. It is not proof of delivery.
2. FEATURELIST decomposes the PRD into stable F01–F32 IDs (extend with new IDs when necessary), completion boundaries and remaining work. Do not renumber IDs when reordering work.
3. ARCHITECTURE derives the technical solution from the PRD, referencing the same feature IDs. Clearly separate implemented contracts from target designs.
4. Harness turns a feature or a bounded slice of it into scenario/rule/task specs with touched paths, expected behavior, acceptance criteria and validation. [FEATURE-MAP](../harness/FEATURE-MAP.md) identifies coverage and gaps; a spec or passing structural validation does not prove a whole feature is implemented.
5. Code and relevant test evidence establish delivered scope. Update FEATURELIST status/evidence and current implementation descriptions after acceptance.
6. Promote only accepted implementation into READMEs and localized guides. PARTIAL rows may contribute their implemented subset only; exclude their outstanding requirements. DONE still has the documented setup and availability boundary.

Code and tests establish actual behavior when prose disagrees; reconcile the PRD, status, design and task instead of silently declaring delivery. Harness reference files are detailed design/compatibility inputs, not a replacement PRD or public guide. Public architecture guides may explain current technical contracts; public development guides may introduce existing commands and tools, but neither may contain proposed implementation plans.

## Change Matrix

| Change | Required updates |
|--------|------------------|
| New or revised requirement | PRODUCT, FEATURELIST, matching ARCHITECTURE design, harness coverage/gap and bounded specs when ready; no public capability claim |
| Implemented functionality | FEATURELIST evidence/status, current ARCHITECTURE details, task/scenario/rule acceptance and validation, affected README and guides in all four locales |
| Defect or compatibility repair | Relevant task and regression evidence; current architecture/reference and public guides only where described behavior changes |
| Environment/tooling change | TROUBLESHOOTING and existing-tooling introductions in all four locales where relevant |
| Introduction-only correction | Parallel localized introductions; verify against implemented scope without changing product status merely to match prose |

The four READMEs retain matching heading sets and their own locale screenshot paths. Each locale directory retains the same four guide filenames. Equivalent facts and prerequisites must agree; literal line-for-line translations are not required. Adding another public guide requires equivalent files in all locales. Generated screenshots are regenerated only when the documented UI actually changes.

## Local-Only Multi-Agent Draft

The file docs/yyclaw-multi-agent-design.md is deliberately retained on disk and excluded from Git. It is not a tracked dependency, harness reference, or delivery source. Removing tracking does not remove it from historical commits. Current Agent management and runtime subagent behavior remain documented; coordinated collaboration backlog remains under F26. If that work resumes, move approved requirements into PRODUCT/FEATURELIST, designs into ARCHITECTURE or harness/reference, and create bounded specs. Do not link tracked documents to the private draft.

## Review Checklist

- Trace requirement → stable feature ID → architecture → task/acceptance evidence.
- Keep unimplemented targets out of all introduction documents, even with a roadmap disclaimer.
- Distinguish DONE/PARTIAL/TODO from GA/developer-gated/requires-setup availability.
- Check equivalent public facts, prerequisites, headings and links in four locales.
- Validate actual task specs with diff checking; reference prose is not executable.
- Keep user-authored work intact and local-only drafts untracked.
