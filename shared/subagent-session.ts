/**
 * Subagent sub-session naming — mirrors {@link ./workflow-session.ts}.
 *
 * When the agent delegates work through its Task tool, OpenClaw spins up a child
 * session for each subagent, keyed with a `subagent:` marker. These are internal:
 * they must never surface as top-level rows in the user-facing session list —
 * their only entry point is a subagent card inlined into the parent conversation.
 *
 * The gateway may namespace the key under the owning agent id (e.g.
 * `agent:main:subagent:<uuid>`), so a plain `startsWith('subagent:')` check would
 * miss that form and leak the sub-session into the sidebar.
 */

/** Prefix that marks a session as an internal subagent (Task-tool) sub-session. */
export const SUBAGENT_SESSION_PREFIX = 'subagent';

/** True when a session key belongs to an internal subagent sub-session. */
export function isSubagentSessionKey(key: string): boolean {
  // Matches the marker as a top-level prefix (`subagent:<uuid>`) OR namespaced
  // under an agent by the gateway (`agent:main:subagent:<uuid>`).
  return /(?:^|:)subagent:/.test(key);
}
