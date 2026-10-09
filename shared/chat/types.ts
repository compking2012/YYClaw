import type { ChatRuntimeEvent } from '../chat-runtime-events';
import type { WorkflowStepMeta, WorkflowCardRef, RunRecord } from '../../src/types/workflow';

/** Metadata for locally-attached files (not from Gateway) */
export interface AttachedFileMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  preview: string | null;
  previewStatus?: 'unavailable';
  filePath?: string;
  source?: 'user-upload' | 'tool-result' | 'message-ref' | 'gateway-media';
  /**
   * For Gateway-injected outgoing media (assistant-media). The Gateway emits
   * an `image` content block with a relative URL like
   * `/api/chat/media/outgoing/<sessionKey>/<attachmentId>/full`. The renderer
   * cannot reach Gateway HTTP directly (CORS / env drift), so this URL is
   * resolved through the Main-process proxy in `media:getThumbnails`, which
   * looks up `~/.openclaw/media/outgoing/records/<attachmentId>.json` and
   * loads the original file off disk.
   */
  gatewayUrl?: string;
}

/** Raw message from OpenClaw chat.history */
export interface RawMessage {
  role: 'user' | 'assistant' | 'system' | 'toolresult';
  content: unknown; // string | ContentBlock[]
  timestamp?: number;
  id?: string;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  stopReason?: string;
  stop_reason?: string;
  errorMessage?: string;
  error_message?: string;
  /** Canonical OpenClaw-owned transcript metadata. */
  __openclaw?: {
    media?: Array<{
      path?: string;
      url?: string;
      contentType?: string;
      kind?: string;
      fileName?: string;
      sizeBytes?: number;
      messageId?: string;
      workspaceDir?: string;
    }>;
  };
  /** Local-only: file metadata for user-uploaded attachments (not sent to/from Gateway) */
  _attachedFiles?: AttachedFileMeta[];
  workflowRunId?: string;
  _workflowSynthetic?: boolean;
}

/** Content block inside a message */
export interface ContentBlock {
  type: 'text' | 'image' | 'thinking' | 'tool_use' | 'tool_result' | 'toolCall' | 'toolResult';
  text?: string;
  thinking?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  /** Flat image format from Gateway tool results (no source wrapper) */
  data?: string;
  mimeType?: string;
  /**
   * Flat URL on an `image` block. Gateway-injected assistant-media messages
   * use this shape: `{ type:'image', url:'/api/chat/media/outgoing/...', mimeType, width, height, alt, openUrl }`.
   * Neither nested `source.url` nor flat `data` is set in that case; the
   * renderer must read `block.url` directly to surface the artifact.
   */
  url?: string;
  /** Optional companion of `url` — points at a higher-resolution variant. */
  openUrl?: string;
  /** Pixel width of the original image, used for layout hints. */
  width?: number;
  /** Pixel height of the original image, used for layout hints. */
  height?: number;
  /** Human-readable filename / alt text emitted by the Gateway. */
  alt?: string;
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
  content?: unknown;
}

/** Session from sessions.list */
export interface ChatSession {
  key: string;
  /** OpenClaw transcript session UUID, used to identify synthetic fallback titles. */
  sessionId?: string;
  label?: string;
  displayName?: string;
  derivedTitle?: string;
  lastMessagePreview?: string;
  thinkingLevel?: string;
  model?: string;
  updatedAt?: number;
  status?: string;
  hasActiveRun?: boolean;
  /** Channel provider that last delivered to this session (e.g. webchat, feishu, discord). */
  channel?: string;
  /** OpenClaw ACP session cwd, mirrored for display and routing. OpenClaw is the source of truth. */
  workspacePath?: string;
  /** Renderer-local placeholder created by New Chat before ACP has created the backing session. */
  createdLocally?: boolean;
}

export type GatewaySessionsChangedPayload = Record<string, unknown> & {
  sessionKey?: string;
  key?: string;
  reason?: string;
  phase?: string;
  ts?: number;
  session?: Record<string, unknown>;
  status?: string;
  hasActiveRun?: boolean;
  updatedAt?: number | null;
};

export type LoadSessionsOptions = {
  force?: boolean;
  gatewayGeneration?: number;
};

export interface ToolStatus {
  id?: string;
  toolCallId?: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  durationMs?: number;
  summary?: string;
  updatedAt: number;
}

export interface ChatRuntimeRunState {
  runId: string;
  sessionKey?: string;
  status: 'running' | 'completed' | 'error' | 'aborted';
  startedAt?: number;
  endedAt?: number;
  assistantText: string;
  thinkingText: string;
  events: ChatRuntimeEvent[];
}

export interface TurnPromptOptimizationStats {
  optimized: number;
  total: number;
  percent: number;
}

export interface DeleteSessionsResult {
  deletedKeys: string[];
  failedKeys: string[];
  warnings?: string[];
}

export type DeleteSessionResult = { success: true; warnings?: string[] } | { success: false; error: string };

export interface ChatState {
  // Messages
  messages: RawMessage[];
  loading: boolean;
  loadingMoreHistory: boolean;
  hasMoreHistory: boolean;
  error: string | null;
  runError: string | null;
  /** Per-session runError text dismissed by the user (sessionKey -> error message). */
  dismissedRunErrors: Record<string, string>;

  // Streaming
  sending: boolean;
  activeRunId: string | null;
  streamingText: string;
  streamingMessage: unknown | null;
  streamingTools: ToolStatus[];
  pendingFinal: boolean;
  lastUserMessageAt: number | null;
  /** Images collected from tool results, attached to the next assistant message */
  pendingToolImages: AttachedFileMeta[];
  runtimeRuns: Record<string, ChatRuntimeRunState>;

  // Sessions
  sessions: ChatSession[];
  currentSessionKey: string;
  currentAgentId: string;
  /** First user message text per session key, used as display label */
  sessionLabels: Record<string, string>;
  /**
   * User's explicit workspace pick per NOT-YET-BOUND session key. Outranks the
   * agent's default workspace while the session is local/unbound; cleared once
   * the session binds (acknowledgeAcpSessionCreated). In-memory only.
   */
  workspaceOverrideBySessionKey: Record<string, string>;
  /**
   * This-conversation-only model override, keyed by session key. Not
   * persisted anywhere — sent to the gateway as a `/model` directive on the
   * session itself, so it's cleared on refresh/restart and never leaks to
   * other conversations using the same agent. `null` means "explicitly reset
   * to the agent's configured default" (as opposed to absent = never set).
   */
  sessionModelOverrideBySessionKey: Record<string, string | null>;
  /** Last message timestamp (ms) per session key, used for sorting */
  sessionLastActivity: Record<string, number>;
  workflowRunBySession: Record<string, string>;
  /**
   * One-shot "resume armed" flag: sessionKey → the runId of a workflow that just
   * failed/aborted in that conversation. Set by the workflow:progress finalizer;
   * consumed by the NEXT user turn, which hands the message to the server's
   * merged resume-vs-new model triage (instead of a brittle regex intent match).
   * In-memory only.
   */
  workflowResumeArmedBySession: Record<string, string>;
  workflowStepsByRun: Record<string, WorkflowStepMeta[]>;
  workflowCardsBySession: Record<string, WorkflowCardRef[]>;
  /**
   * Live per-run state for OBSERVED workflow cards (a workflow-shaped skill that
   * ran inside a normal agent turn). Keyed by a synthetic observed id (session-
   * scoped, spans multiple gateway runs). Shaped as the same RunRecord the
   * WorkflowInlineCard/WorkflowRunPanel already consume. In-memory only.
   */
  observedWorkflowByRun: Record<string, RunRecord>;
  /** sessionKey → the session's currently-active observed workflow id. In-memory only. */
  activeObservedBySession: Record<string, string>;
  /**
   * Transient per-observed-workflow progress used to attribute streamed assistant
   * text to the step in progress. `offset` is a length into the current gateway
   * run's accumulated `assistantText`. In-memory only.
   */
  observedProgressById: Record<string, { runId: string; offset: number; currentStepId: string | null }>;
  /**
   * Explicit/implicit staging for observed cards. Set at send (`/skill-name`) or
   * when the model `Read`s a workflow skill's SKILL.md. The card itself is only
   * created on the FIRST TodoWrite/update_plan (so it shows real steps, not a
   * parsed preview). In-memory only.
   */
  pendingObservedSkillBySession: Record<string, {
    skillName: string;
    title: string;
    userMessageId: string;
    userText: string;
  }>;
  /**
   * The runId of the single workflow card currently shown in the floating
   * panel (see WorkflowFloatingPanel), or null if none is open. In-memory
   * only — set automatically when a card is first created, and cleared when
   * the user closes the panel; reopening afterward requires clicking the
   * card's link in the transcript.
   */
  openWorkflowPopupRunId: string | null;
  /**
   * The session key whose engine workflow is currently being decomposed by the
   * server ("生成即分诊"). Engine turns send no ACP prompt, so this drives the
   * composer's normal "thinking" indicator during the wait; the workflow card
   * itself is only added once the server resolves. Null when idle. In-memory only.
   */
  workflowRoutingSessionKey: string | null;

  // Thinking
  thinkingLevel: string | null;
  turnPromptOptimization?: Record<string, TurnPromptOptimizationStats>;

  // Actions
  loadSessions: (options?: LoadSessionsOptions) => Promise<void>;
  handleSessionsChanged: (payload: GatewaySessionsChangedPayload) => void;
  switchSession: (key: string) => void;
  selectAcpSession: (key: string, workspacePath?: string) => void;
  newSession: () => void;
  setSessionWorkspaceOverride: (sessionKey: string, workspacePath: string) => void;
  setSessionModelOverride: (sessionKey: string, modelRef: string | null) => void;
  acknowledgeAcpSessionCreated: (key: string, workspacePath?: string, initialPrompt?: string) => void;
  deleteSession: (key: string) => Promise<DeleteSessionResult>;
  deleteSessions: (keys: string[]) => Promise<DeleteSessionsResult>;
  removeAgentSessions: (agentId: string) => void;
  reconcileAgentSessionTombstones: (agentIds: string[]) => void;
  renameSession: (key: string, label: string) => Promise<void>;
  cleanupEmptySession: () => void;
  loadHistory: (quiet?: boolean) => Promise<void>;
  loadMoreHistory: () => Promise<void>;
  sendMessage: (
    text: string,
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      fileSize: number;
      stagedPath: string;
      preview: string | null;
    }>,
    targetAgentId?: string | null,
  ) => Promise<void>;
  clearWorkflowRun: (sessionKey: string) => void;
  /**
   * Auto-workflow routing for the ACP send path (independent, non-ACP lane).
   * Decides whether the turn should run as a server-orchestrated engine workflow
   * (guarded by the `autoWorkflowEnabled` setting) and, if so, starts it +
   * registers the persisted card + seeds the workflow store, then resolves
   * `true` so the caller skips the ACP prompt. Also stages observed cards for an
   * explicit `/skill-name` turn or the auto-router's skill deferral, in which
   * case it resolves `false` (the turn still goes to the agent as an ACP prompt).
   */
  routeAndMaybeStartWorkflow: (
    text: string,
    sessionKey: string,
    targetAgentId?: string | null,
  ) => Promise<boolean>;
  /**
   * Apply an observed-workflow signal derived from the ACP timeline (see
   * `src/lib/acp/observed-workflow-projection.ts`). Arms the session from an
   * implicit workflow-skill SKILL.md `Read` only while a live ACP turn is
   * sending (`opts.live`), never from historical replay alone. Terminal cards
   * for the same activation win; orphan `running` cards are not hydrated when
   * `!live`. Explicit `/skill` pending staging is unaffected.
   */
  ingestAcpObservedWorkflow: (
    sessionKey: string,
    signal: {
      activationKey: string;
      skill: { name: string; title: string } | null;
      userMessageId: string;
      userText: string;
      todos: { content: string; status: string }[];
      hasPlan: boolean;
    },
    opts?: { live?: boolean },
  ) => void;
  addWorkflowCard: (sessionKey: string, card: WorkflowCardRef) => void;
  /**
   * Add a provisional (`pending`) engine card the instant a turn routes to a
   * workflow, so the query bubble shows immediately while the server decomposes.
   * Unlike `addWorkflowCard` it neither arms the finalizer (the runId is
   * synthetic) nor opens the floating panel, and it is never persisted.
   */
  addPendingWorkflowCard: (sessionKey: string, card: WorkflowCardRef) => void;
  /**
   * Swap a provisional card in place for the resolved run: keeps `createdAt`,
   * `acpAnchorItemId`, `userText`, `messageId`, `userMessageId` (so the query
   * bubble never remounts) while setting the real `runId`/`steps`/`title`/
   * `status`, clearing `pending`, arming the finalizer, persisting, and opening
   * the floating panel on the real run.
   */
  promoteWorkflowCard: (
    sessionKey: string,
    provisionalId: string,
    patch: { runId: string; title: string; steps: WorkflowStepMeta[]; status: WorkflowCardRef['status'] },
  ) => void;
  /** Remove a card (used to drop a provisional placeholder when routing falls through). */
  removeWorkflowCard: (sessionKey: string, runId: string) => void;
  finalizeWorkflowCard: (
    runId: string,
    patch: {
      status: WorkflowCardRef['status'];
      finalText?: string;
      error?: string;
      stepProgress?: WorkflowCardRef['stepProgress'];
    },
  ) => void;
  /**
   * Cold-start / post-load convergence for observed cards stuck at `running`
   * while no live ACP send is in flight. Matching projection todos that are all
   * completed finalize as `done`; otherwise the card becomes `failed` /
   * `interrupted`. Idempotent with ingest's `!live` gates.
   */
  healStaleObservedWorkflows: (
    sessionKey: string,
    opts?: {
      live?: boolean;
      signal?: {
        userMessageId: string;
        activationKey: string;
        todos: { content: string; status: string }[];
        hasPlan: boolean;
      } | null;
    },
  ) => void;
  /** Open the floating workflow panel on the given run (replaces any other open panel). */
  openWorkflowPopup: (runId: string) => void;
  /** Close the floating workflow panel. */
  closeWorkflowPopup: () => void;
  /**
   * Apply the agent's TodoWrite/update_plan to the session's observed workflow:
   * creates the card on the FIRST call (from the staged pending skill, using the
   * todos as the real steps), updates step statuses, attributes the assistant
   * text produced since the last step transition to the completing step's result,
   * and finalizes (done) when all todos are completed.
   */
  applyObservedTodos: (
    sessionKey: string,
    todos: { content: string; status: string }[],
    ctx: { assistantText: string; runId: string },
  ) => void;
  /** Flush the current run's trailing assistant text to the in-progress step (on run end). */
  flushObservedText: (sessionKey: string, ctx: { assistantText: string; runId: string }) => void;
  /**
   * Fail observed workflows for the session (run aborted/errored/interrupted).
   * Clears pending staging, finalizes every `source:'observed'` card still
   * `running` (not only `activeObservedBySession`), and drops the active
   * pointer — so orphan running cards cannot survive Stop or a later heal.
   */
  failObservedWorkflow: (sessionKey: string, error?: string) => void;
  beginExternalSessionRun?: (payload: { sessionKey: string; promptText: string }) => void;
  abortRun: () => Promise<void>;
  handleChatEvent: (event: Record<string, unknown>) => void;
  handleRuntimeEvent: (event: ChatRuntimeEvent) => void;
  refresh: () => Promise<void>;
  clearError: () => void;
}

export const DEFAULT_CANONICAL_PREFIX = 'agent:main';
export const DEFAULT_SESSION_KEY = `${DEFAULT_CANONICAL_PREFIX}:main`;
