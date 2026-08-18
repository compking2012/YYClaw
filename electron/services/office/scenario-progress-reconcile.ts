import { listScenarioRoomMessages, listScenarios, listTasks } from './store';
import { roomMessageProjectId } from '../../../src/lib/office-agent-id-resolve';
import { persistTaskProgressReconciled } from './task-room-progress-reconcile';
import { isTaskUserAborted } from './task-run-abort-registry';

/** Reconcile persisted task nodeRuns with team-room phased messages for one scenario. */
export async function reconcileScenarioTaskProgress(scenarioId: string): Promise<number> {
  const scenario = (await listScenarios()).find((s) => s.id === scenarioId);
  if (!scenario) return 0;

  const [tasks, room] = await Promise.all([
    listTasks(scenarioId),
    listScenarioRoomMessages(scenarioId),
  ]);
  let updated = 0;

  for (const task of tasks) {
    if (isTaskUserAborted(task.id)) continue;

    const hasRoomLines = room.some((m) => roomMessageProjectId(m) === task.id);
    const hasRunnerState =
      task.status === 'running' ||
      task.nodeRuns.some((r) => r.status !== 'pending');
    if (!hasRoomLines && !hasRunnerState) continue;

    const saved = await persistTaskProgressReconciled(scenarioId, task.id);
    if (saved) updated += 1;
  }

  return updated;
}
