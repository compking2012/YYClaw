import type { GatewayManager } from '../../gateway/manager';
import { getTempProject, upsertTempProject } from './store';
import { runOfficeProject } from './task-run';
import { isWorkflowReviewActive, isUserCheckpointEnabled } from '../../../src/lib/office-workflow-user-checkpoint';
import type { OfficeFixedGroup, OfficeTempProject } from './types';

function isWorkflowStallPendingError(error: string | undefined): boolean {
  const t = (error ?? '').trim();
  if (!t) return false;
  return /workflow blocked|workflow stalled|stall/i.test(t);
}

/** 解除 Workflow blocked 并 continue 续跑。 */
export async function unblockWorkflowProject(
  gateway: GatewayManager,
  project: OfficeTempProject,
  group: OfficeFixedGroup,
): Promise<OfficeTempProject> {
  const fresh = await getTempProject(project.id);
  if (!fresh) throw new Error('Project not found');
  if (fresh.status !== 'blocked') {
    throw new Error('Project is not blocked');
  }
  if (isUserCheckpointEnabled() && isWorkflowReviewActive(fresh)) {
    throw new Error('Project is awaiting user review; use review API instead of unblock');
  }

  const clearedRuns = fresh.nodeRuns.map((nr) => {
    if (nr.status === 'pending' && isWorkflowStallPendingError(nr.error)) {
      return { ...nr, error: undefined };
    }
    return nr;
  });

  const unlocked = await upsertTempProject({
    ...fresh,
    status: 'running',
    nodeRuns: clearedRuns,
    workflowStall: undefined,
    updatedAt: Date.now(),
  });

  void runOfficeProject(gateway, unlocked, group, { mode: 'continue' }).catch((err) => {
    console.warn('[office] unblock continue run failed:', err);
  });
  return unlocked;
}
