import type { GatewayManager } from './manager';
import { logger } from '../utils/logger';

/**
 * Delete a session by delegating to the running Gateway's `sessions.delete`
 * RPC, so the mutation joins the Gateway's serialized session-store writer and
 * its in-memory cache is updated.
 *
 * Why this exists: the Gateway owns `sessions.json` through an in-process,
 * serialized writer plus an in-memory cache. Editing `sessions.json` directly
 * on disk while the Gateway is running is only an *offline-maintenance* path —
 * the Gateway's next metadata write rewrites the file from its cache and
 * resurrects the entry (especially for workflow sessions, which keep the
 * Gateway writing). Routing the delete through the RPC is the supported online
 * mutation path (the same way `openclaw sessions cleanup` / `agents delete`
 * delegate to the Gateway).
 *
 * `deleteTranscript: true` matches the Gateway control-UI behaviour and removes
 * the transcript as part of the same writer-queued operation.
 *
 * Returns `{ ok: true }` only when the RPC actually succeeded. When the Gateway
 * is not connected, or the RPC throws/rejects, returns `{ ok: false, error }`
 * so callers can fall back to the offline disk path.
 */
export async function tryGatewaySessionDelete(
  gatewayManager: GatewayManager,
  sessionKey: string,
): Promise<{ ok: boolean; error?: string }> {
  // Defensive: callers may not have a manager wired up (e.g. unit tests that
  // exercise the offline disk path). Treat that as "not connected" so the
  // caller falls back instead of throwing.
  if (!gatewayManager || typeof gatewayManager.isConnected !== 'function' || !gatewayManager.isConnected()) {
    return { ok: false, error: 'gateway-not-connected' };
  }
  try {
    await gatewayManager.rpc('sessions.delete', { key: sessionKey, deleteTranscript: true });
    logger.info(`[session:delete] deleted "${sessionKey}" via gateway sessions.delete RPC`);
    return { ok: true };
  } catch (error) {
    logger.warn(`[session:delete] gateway sessions.delete RPC failed for "${sessionKey}": ${String(error)}`);
    return { ok: false, error: String(error) };
  }
}

/**
 * Delete the internal `wf:<runId>:<step>` sub-sessions a workflow run created
 * (each node runs in its own deterministic gateway session). Enumerates the
 * Gateway's session list and deletes every key carrying the run marker —
 * including agent-namespaced forms like `agent:main:wf:<runId>:<step>`.
 * Best-effort: never throws; requires a connected Gateway.
 */
export async function deleteWorkflowChildSessions(
  gatewayManager: GatewayManager,
  workflowRunId: string,
): Promise<string[]> {
  const warnings: string[] = [];
  if (!gatewayManager || typeof gatewayManager.isConnected !== 'function' || !gatewayManager.isConnected()) {
    return warnings;
  }
  const marker = `wf:${workflowRunId}:`;
  try {
    const listed = await gatewayManager.rpc<{ sessions?: Array<{ key?: string }> }>('sessions.list', {});
    const sessions = Array.isArray(listed?.sessions) ? listed.sessions : [];
    const targets = sessions.filter((s) => typeof s.key === 'string' && s.key.includes(marker));
    for (const session of targets) {
      try {
        await gatewayManager.rpc('sessions.delete', { key: session.key, deleteTranscript: true });
        logger.info(`[session:delete] deleted workflow child session "${session.key}" (run ${workflowRunId})`);
      } catch (error) {
        warnings.push(`Could not delete workflow child ${session.key}: ${String(error)}`);
        logger.warn(`[session:delete] sessions.delete failed for child "${session.key}": ${String(error)}`);
      }
    }
  } catch (error) {
    warnings.push(`Could not list workflow children for ${workflowRunId}: ${String(error)}`);
    logger.warn(`[session:delete] could not enumerate workflow child sessions for run ${workflowRunId}: ${String(error)}`);
  }
  return warnings;
}

interface GatewayTaskRow {
  taskId?: string;
  status?: string;
  requesterSessionKey?: string;
  ownerKey?: string;
  childSessionKey?: string;
}

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running']);

/**
 * Cancel the still-running background Task Flow work tied to a session that is
 * being deleted, so deleting a session with an in-flight workflow actually
 * stops it (otherwise the live run keeps producing events / re-surfacing the
 * session). Best-effort: never throws — failures are logged and ignored.
 *
 * A workflow's per-step tasks run under deterministic `wf:<runId>:<step>`
 * sub-session keys, so when a `workflowRunId` is known we also match tasks whose
 * owner/requester contains `wf:<runId>:`.
 *
 * NOTE: this only cancels ACTIVE tasks. OpenClaw deliberately retains TERMINAL
 * Task Flow records (`succeeded`/`failed`) for ~7 days for delivery/audit, and
 * exposes no force-delete RPC — `tasks.cancel` is a no-op on them. Those expire
 * on their own (or via `openclaw tasks maintenance --apply` once past
 * retention); they are not removed here.
 */
export async function cancelSessionBackgroundTasks(
  gatewayManager: GatewayManager,
  sessionKey: string,
  workflowRunId?: string,
): Promise<void> {
  if (!gatewayManager || typeof gatewayManager.isConnected !== 'function' || !gatewayManager.isConnected()) {
    return;
  }
  try {
    const listed = await gatewayManager.rpc<{ tasks?: GatewayTaskRow[] }>('tasks.list', {});
    const tasks = Array.isArray(listed?.tasks) ? listed.tasks : [];
    const wfMarker = workflowRunId ? `wf:${workflowRunId}:` : null;

    const matches = (value: string | undefined): boolean => {
      if (!value) return false;
      if (value === sessionKey) return true;
      return wfMarker != null && value.includes(wfMarker);
    };

    const targets = tasks.filter(
      (t) =>
        t.taskId
        && ACTIVE_TASK_STATUSES.has(String(t.status))
        && (matches(t.requesterSessionKey) || matches(t.ownerKey) || matches(t.childSessionKey)),
    );

    for (const task of targets) {
      try {
        await gatewayManager.rpc('tasks.cancel', { taskId: task.taskId, reason: 'session-deleted' });
        logger.info(`[session:delete] cancelled active task ${task.taskId} for "${sessionKey}"`);
      } catch (error) {
        logger.warn(`[session:delete] tasks.cancel failed for ${task.taskId}: ${String(error)}`);
      }
    }
  } catch (error) {
    logger.warn(`[session:delete] could not enumerate tasks for "${sessionKey}": ${String(error)}`);
  }
}
