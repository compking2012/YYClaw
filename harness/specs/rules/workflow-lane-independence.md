---
id: workflow-lane-independence
title: Workflow Lane Independence
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
---

The Chat page's XState "auto-workflow" lane is an INDEPENDENT, non-ACP feature. It visualizes engine-orchestrated dynamic workflows and observed workflow-shaped skill runs as cards rendered inside the conversation. It is not a transcript supplement, not a parallel history, and not an ACP protocol projection.

Workflow cards are sourced only from the fork's own persisted store (`workflowCardsBySession`, localStorage-backed) and the Main-owned `workflow:progress` event stream (via `useWorkflowStore`). They must NEVER be inserted into `acpTimeline.itemsById`/`itemOrder`, nor read back out of the ACP timeline as history — doing so would violate `acp-chat-state-and-history` (ACP replay is the primary history authority, and there is no second reduced Chat history). Removing a card, reloading, or switching sessions must never mutate ACP timeline state.

Cards MAY be interleaved into the conversation at RENDER time. `buildConversationBlocks` (`src/pages/Chat/workflow-timeline-merge.ts`) is a pure function that merges the ACP display groups with the session's workflow cards into an ordered render sequence, placing each card at its `acpAnchorItemId` (the last ACP item present when the card was created). This is render-only: it reads the card store and the reduced snapshot, and never writes to `acpTimeline`. An ENGINE (single-agent auto) workflow never sends an ACP prompt, so its triggering user message and synthesized reply live only on the card and are rendered from the card (`WorkflowTurnBlock`) as user/assistant bubbles; an OBSERVED card's turn already lives in the ACP transcript, so only its compact link renders. The empty/welcome state shows only when BOTH the ACP timeline and the workflow lane are empty.

Routing is decided on the send path (`routeAndMaybeStartWorkflow`) before any ACP prompt and is gated by the `autoWorkflowEnabled` setting: a server-orchestrated engine workflow is started in place of the ACP prompt (no prompt is sent), while explicit `/skill-name` turns and the auto-router's skill deferral only stage an observed card and still run as a normal ACP prompt.

Observed workflows are DETECTED, not orchestrated: a read-only projection (`src/lib/acp/observed-workflow-projection.ts`) inspects the reduced `AcpTimelineSnapshot`'s `ToolCallItem`s — `TodoWrite`/`update_plan` plans and `Read` of a workflow skill's `SKILL.md` — and emits an idempotent signal that the chat store's observed-workflow actions turn into card create/progress/finalize. The projection must stay pure (snapshot in, signal out) and must not mutate the timeline; the caller dedupes unchanged signals so the store actions run only on real changes. Detection must be defensive about OpenClaw's ACP tool-call shape (tool name parsed from `title`, arguments read from `input`/`rawInput`).

Because ACP Chat intentionally does not drive the workflow lane from Gateway `run.ended`, user cancel (`cancelAcp` / `session/cancel`) MUST finalize any active observed card via `failObservedWorkflow` and settle live in-flight plan/tool items (`settleAcpTimelineAfterCancel`). Main cancel also best-effort calls Gateway `chat.abort` so mid-flight LLM/tool work stops alongside the ACP prompt. The cancelled generation remains marked aborted until the next `sendPrompt`, so late buffered plan/tool session updates cannot permanently revive `in_progress` / running UI after Stop.

`failObservedWorkflow` MUST clear pending staging and finalize every `source:'observed'` card still `running` in the session (not only `activeObservedBySession`), so orphan running cards cannot survive Stop or a crash. Observed cards persist a `stepProgress` snapshot on terminal writes so reload can show `k/N` without the in-memory run.

Observed activation identity is the *latest* user turn that contains workflow-shaped tools (`projectAcpObservedWorkflow`). Historical ACP session-load replay MUST NOT implicitly arm or create observed cards: `ingestAcpObservedWorkflow(..., { live })` allows Read-based arming only while an ACP send is in flight (`live: true` / `acpSending`). Terminal cards for the same activation win; orphan `running` cards are not hydrated when `!live`. After load settles with no live send, `healStaleObservedWorkflows` converges remaining `running` observed cards to `done` (all projected todos completed) or `failed`/`interrupted` (otherwise). Explicit `/skill` pending staging on the send path remains independent of the live gate.

The legacy Gateway execution graph (`ExecutionGraphCard` and the runtime-graph runtime-event path) is intentionally NOT rendered on the ACP-native Chat page; observed-workflow visualization on ACP is driven by the timeline projection above, not by Gateway `tool.started`/`run.ended` runtime events.
