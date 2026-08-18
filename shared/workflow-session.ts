/**
 * Workflow sub-session naming — the single source of truth shared by the main
 * process (workflow adapter, which CREATES the gateway sub-session) and the
 * renderer (which RECONSTRUCTS the key to drill into a node's sub-conversation).
 *
 * A workflow node does not get its own top-level session; it runs in a gateway
 * session that is deterministically derived from the run + step ids, so:
 *  - the renderer can rebuild the exact key from `(runId, stepId)` without
 *    parsing anything, and fetch that node's transcript on demand;
 *  - resuming a run reuses the same key (idempotent), instead of minting a new
 *    random `wf-agent:*` session each time.
 *
 * These keys are internal: they are filtered out of the user-facing session
 * list and always sent with `deliver:false`.
 */

/** Prefix that marks a session as an internal workflow sub-session. */
export const WORKFLOW_SESSION_PREFIX = 'wf';

/** Legacy random sub-session prefix (pre-deterministic-key). Still filtered from the session list. */
export const LEGACY_WORKFLOW_SESSION_PREFIX = 'wf-agent';

/** Deterministic gateway session key for one workflow node. */
export function childSessionKey(runId: string, stepId: string): string {
  return `${WORKFLOW_SESSION_PREFIX}:${runId}:${stepId}`;
}

/** True when a session key belongs to an internal workflow sub-session (any era). */
export function isWorkflowSessionKey(key: string): boolean {
  // Matches the marker as a top-level prefix (`wf:run:step`) OR namespaced under
  // an agent by the gateway (`agent:main:wf:run:step`) — OpenClaw may prefix the
  // agent id onto the sessionKey we pass to `chat.send`, so a plain
  // `startsWith('wf:')` check would miss the namespaced form and leak the
  // sub-session into the user's list.
  return (
    /(?:^|:)wf:/.test(key) ||
    /(?:^|:)wf-agent:/.test(key)
  );
}
