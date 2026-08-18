/**
 * Per-node workflow dispatch run id.
 * Nodes in one workflow run share `task.workflowRunId`; `@nodeId` on dispatch ids
 * dedupes idempotency keys. Settle listens on the scoped dispatch id; lifecycle
 * matching accepts bare or scoped Gateway forms via {@link gatewayEventMatchesRun}.
 */
export function officeWorkflowNodeDispatchRunId(
  workflowRunId: string | undefined,
  nodeId: string,
  taskId: string,
): string {
  const base = workflowRunId?.trim() || `norun-${taskId}`;
  const node = nodeId.trim();
  if (!node) return base;
  if (base.includes('@')) return base;
  return `${base}@${node}`;
}

export function isOfficeTaskScopedRunId(runId: string): boolean {
  return runId.trim().startsWith('office-task-');
}

/** Trailing `@gen-N` node scope on dispatch / idempotency run ids. */
export function officeWorkflowNodeScopeSuffix(runId: string): string | undefined {
  return runId.trim().match(/@(gen-\d+)\s*$/i)?.[1]?.toLowerCase();
}

/** Bare `run-<ts>` tail from dispatch idempotency key, scoped dispatch, or gateway runId. */
export function officeWorkflowBareRunTail(runId: string): string | undefined {
  const trimmed = runId.trim();
  if (!trimmed) return undefined;
  const colonRun = trimmed.match(/:run:(run-[^:\s@]+)\s*$/i);
  if (colonRun?.[1]) return colonRun[1];
  const tail = trimmed.match(/(run-[^:\s@]+)(?:@[^:\s]+)?\s*$/i);
  return tail?.[1];
}

/**
 * Run id used by Model B settle gate (`waitForSessionReply` / tracker registry).
 *
 * Node-scoped dispatch ids (`run-ts@gen-N`) stay scoped for settle so Gateway
 * lifecycle idempotency keys (`office-task-...-run-ts@gen-N`) match. Bare lifecycle
 * events still match via {@link gatewayEventMatchesRun}. Cross-node safety uses
 * `@gen-N` suffix plus per-node sessionKey / settleTrackerKey.
 */
export function resolveWorkflowSettleRunId(
  gatewayRunId: string | undefined,
  dispatchRunId: string | undefined,
): string | undefined {
  const dispatch = dispatchRunId?.trim() ?? '';
  const gateway = gatewayRunId?.trim() ?? '';

  if (!dispatch.includes('@')) {
    return gateway || dispatch || undefined;
  }

  if (gateway) {
    const gatewayBare = officeWorkflowBareRunTail(gateway);
    const dispatchBare = officeWorkflowBareRunTail(dispatch);
    if (gatewayBare && dispatchBare && gatewayBare === dispatchBare) {
      return dispatch;
    }
  }

  return dispatch;
}
