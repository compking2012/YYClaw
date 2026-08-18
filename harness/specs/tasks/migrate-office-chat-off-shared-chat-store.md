---
id: migrate-office-chat-off-shared-chat-store
title: Migrate Office room chat off the shared chat store
scenario: chat-workspace-and-navigation
taskType: renderer-state
intent: Split the pre-ACP message pipeline out of src/stores/chat.ts into an Office-scoped store so the shared chat store converges on upstream's session-catalog shape.
touchedAreas:
  - harness/specs/tasks/migrate-office-chat-off-shared-chat-store.md
  - shared/chat/types.ts
  - src/stores/chat.ts
  - src/stores/office-chat.ts
  - src/stores/gateway.ts
  - src/pages/Office/OfficeChatPanel.tsx
  - src/lib/workflow-api.ts
  - src/components/layout/Sidebar.tsx
expectedUserBehavior:
  - Office project and room chat keeps its current send, history, streaming, and error behavior.
  - The ACP chat page is unaffected; it already renders from the ACP timeline store.
  - Per-conversation model override, workspace override, and workflow cards keep working on the chat page.
requiredProfiles:
  - fast
requiredRules:
  - renderer-main-boundary
  - acp-chat-state-and-history
requiredTests:
  - pnpm exec vitest run tests/unit/chat-office-session-retarget.test.tsx
  - pnpm exec vitest run tests/unit/chat-runtime-event-handlers.test.ts
  - pnpm exec vitest run tests/unit/gateway-events.test.ts
  - pnpm run typecheck
acceptance:
  - src/stores/chat.ts exposes only session-catalog state plus the local session-override and workflow-card surface.
  - The legacy message pipeline (messages, streaming, runtimeRuns, sendMessage, loadHistory, handleChatEvent, handleRuntimeEvent) lives in an Office-scoped store.
  - src/stores/gateway.ts routes chat and runtime events to the Office-scoped store instead of the shared chat store.
  - No renderer file imports src/pages/Chat/ChatMessage.tsx or src/pages/Chat/message-utils.ts from the shared chat store path.
docs:
  required: false
---

## Why this task exists

Upstream ClawX `#1224` reduced `src/stores/chat.ts` to a session catalog (1377 lines): sessions,
current session, labels, last activity, and session CRUD. All turn and message state moved to the
ACP-native `src/stores/acp-chat-session.ts`. It also deleted `src/pages/Chat/ChatMessage.tsx`,
`src/pages/Chat/message-utils.ts`, `src/pages/Chat/ExecutionGraphCard.tsx`, and seven
`src/stores/chat/*` modules.

YYClaw's chat page had already moved to ACP — `src/pages/Chat/index.tsx` renders
`AcpTimelineGroup` from `groupAcpTimelineItems(acpTimeline)`, and `src/lib/acp/` carries the
local-only `observed-workflow-projection.ts`, `subagent-projection.ts`, and
`settle-after-cancel.ts`. So the shared chat store's remaining pre-ACP pipeline is no longer used
by the chat page at all.

What still depends on it, verified against the merge base:

| Consumer | Uses |
|---|---|
| `src/pages/Office/OfficeChatPanel.tsx` | `messages`, `loading`, `sending`, `error`, `switchSession`, `clearError`, `sendMessage`, plus `ChatMessage` |
| `src/stores/office.ts` | `messages` |
| `src/lib/workflow-api.ts` | `messages` |
| `src/components/layout/Sidebar.tsx` | `loadHistory` |
| `src/stores/gateway.ts` | `loadHistory`, `handleChatEvent`, `handleRuntimeEvent` |

Office rooms are multi-participant project chats, which do not map onto ACP's single-agent
session model. Rather than delete the feature or force it through ACP, the pipeline moves to a
store owned by Office.

## Field split

`ChatState` in `shared/chat/types.ts` currently mixes three groups. The migration keeps groups 2
and 3 in `ChatState` and moves group 1 to `OfficeChatState`.

1. **Office-scoped message pipeline** — `messages`, `loading`, `loadingMoreHistory`,
   `hasMoreHistory`, `error`, `runError`, `dismissedRunErrors`, `sending`, `activeRunId`,
   `streamingText`, `streamingMessage`, `streamingTools`, `pendingFinal`, `lastUserMessageAt`,
   `pendingToolImages`, `runtimeRuns`, `thinkingLevel`, `turnPromptOptimization`,
   `cleanupEmptySession`, `loadHistory`, `loadMoreHistory`, `sendMessage`, `abortRun`,
   `handleChatEvent`, `handleRuntimeEvent`, `refresh`, `clearError`.
2. **Session catalog, shared with upstream** — `sessions`, `currentSessionKey`, `currentAgentId`,
   `sessionLabels`, `sessionLastActivity`, `loadSessions`, `handleSessionsChanged`,
   `switchSession`, `selectAcpSession`, `newSession`, `acknowledgeAcpSessionCreated`,
   `deleteSession`, `deleteSessions`, `renameSession`.
3. **Local catalog extensions, stay in `ChatState`** — `workspaceOverrideBySessionKey`,
   `sessionModelOverrideBySessionKey`, `setSessionWorkspaceOverride`, `setSessionModelOverride`,
   and the workflow-card surface (`workflowRunBySession`, `workflowResumeArmedBySession`,
   `workflowStepsByRun`, `workflowCardsBySession`, `observedWorkflowByRun`,
   `activeObservedBySession`, `observedProgressById`, `pendingObservedSkillBySession`,
   `openWorkflowPopupRunId`, `workflowRoutingSessionKey`, and their actions).

`ToolStatus`, `ChatRuntimeRunState`, and `TurnPromptOptimizationStats` are retained because the
Office pipeline uses them; upstream dropped them along with its own pipeline.

## Modules that stay for Office

These were deleted upstream and are kept because only the Office pipeline reaches them:
`src/pages/Chat/ChatMessage.tsx`, `src/pages/Chat/message-utils.ts`,
`src/pages/Chat/ExecutionGraphCard.tsx`, and `src/stores/chat/{history-actions,internal,
runtime-event-actions,runtime-event-handlers,runtime-graph,runtime-send-actions,session-actions}.ts`.
After this task they should be re-homed under an Office-owned path so the `src/pages/Chat/` and
`src/stores/chat/` trees match upstream.

## Out of scope

- ACP transport, Main-process routing, and timeline reduction semantics.
- The Streamdown renderer configuration, which upstream already owns.
- Deleting or reshaping any Office feature.
