import type { GatewayManager } from '../../gateway/manager';
import type { GatewayStatus } from '../../../shared/types/gateway';
import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';
import type { OfficeTempProject } from './types';
import { isTempProjectArchived } from './agent-binding';
import { isTaskUserAborted } from './task-run-abort-registry';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';
import { isSmartTaskMarkedRunning } from './smart-task-completion';
import { taskExecutionMode } from './task-execution-mode';

const GATEWAY_INTERRUPT_ERROR_RE =
  /request was aborted|websocket closed|gateway is not running|econnreset|transcript tail is not resumable|^aborted$/iu;

export function isGatewayReadyForOfficeExecution(
  status: Pick<GatewayStatus, 'state' | 'gatewayReady'>,
): boolean {
  return status.state === 'running' && status.gatewayReady !== false;
}

export function isGatewayInterruptTransportError(message: string | undefined): boolean {
  const text = message?.trim();
  if (!text) return false;
  return GATEWAY_INTERRUPT_ERROR_RE.test(text);
}

function projectHasActiveRunner(projectId: string, project: OfficeTempProject): boolean {
  if (isWorkflowTaskRunnerActive(projectId)) return true;
  if (taskExecutionMode(project) === 'smart' && isSmartTaskMarkedRunning(projectId)) return true;
  return false;
}

/** Persisted project lost its in-memory runner but should keep executing after Gateway returns. */
export function projectNeedsGatewayResume(project: OfficeTempProject): boolean {
  if (isTempProjectArchived(project)) return false;
  if (isTaskUserAborted(project.id)) return false;
  if (projectHasActiveRunner(project.id, project)) return false;
  if (isOfficeProjectExecuting(project)) return true;
  if (project.status !== 'failed') return false;
  return project.nodeRuns.some(
    (nr) => nr.status === 'failed' && isGatewayInterruptTransportError(nr.error),
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGatewayOfficeReady(
  gateway: GatewayManager,
  signal?: AbortSignal,
  timeoutMs = 120_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) return false;
    const status = gateway.getStatus();
    if (isGatewayReadyForOfficeExecution(status) && gateway.isConnected()) {
      return true;
    }
    await delay(500);
  }
  return false;
}

const resumeInFlight = new Set<string>();

export async function resumeOrphanedOfficeProjectsAfterGatewayReady(
  gateway: GatewayManager,
): Promise<void> {
  const status = gateway.getStatus();
  if (!isGatewayReadyForOfficeExecution(status) || !gateway.isConnected()) return;

  const { listTempProjects } = await import('./store');
  const { listFixedGroups } = await import('./store');
  const { runOfficeProject } = await import('./task-run');
  const { fixedGroupContextForProjectRecord } = await import('../../../src/lib/office-task-workflow');

  const [projects, groups] = await Promise.all([listTempProjects(), listFixedGroups()]);
  const candidates = projects.filter(projectNeedsGatewayResume);
  if (candidates.length === 0) return;

  const { rebuildOfficeSpawnPolicyRefsFromStore } = await import('./office-spawn-policy-reconcile');
  await rebuildOfficeSpawnPolicyRefsFromStore();

  for (const project of candidates) {
    if (resumeInFlight.has(project.id)) continue;
    resumeInFlight.add(project.id);
    const group = fixedGroupContextForProjectRecord(project, groups);
    console.info('[office] auto-resuming project after Gateway ready', {
      projectId: project.id,
      title: project.title,
      status: project.status,
    });
    void runOfficeProject(gateway, project, group, { mode: 'continue' })
      .catch((err) => {
        console.warn('[office] auto-resume after Gateway ready failed:', project.id, err);
      })
      .finally(() => {
        resumeInFlight.delete(project.id);
      });
  }
}
