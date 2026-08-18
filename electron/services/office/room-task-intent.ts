import type { GatewayManager } from '../../gateway/manager';
import { roomMessageRequestsCoordinatorFullRestart } from '../../../src/lib/office-room-task-restart';
import { pickScenarioTaskForRoom } from '../../../src/lib/office-room-task-resolve';
import { appendRoomMessage, clearTaskRunArtifacts, listScenarios, listTasks } from './store';
import { runOfficeTask, abortOfficeTaskRun } from './task-run';

export {
  extractTaskTitleHintsFromRoomContent,
  normalizeTaskTitleForMatch,
  pickScenarioTaskForRoom,
  resolveTaskFromRoomContent,
  scoreTaskTitleMatch,
} from '../../../src/lib/office-room-task-resolve';

export { roomMessageRequestsCoordinatorFullRestart, roomMessageRequestsTaskRerun } from '../../../src/lib/office-room-task-restart';

export async function triggerTaskRerunFromRoom(
  gateway: GatewayManager,
  scenarioId: string,
  content: string,
  opts?: { fromRoleId?: string; coordinatorRoleId?: string },
): Promise<{ triggered: boolean; taskId?: string; error?: string }> {
  if (!roomMessageRequestsCoordinatorFullRestart(content)) {
    return { triggered: false };
  }

  if (
    opts?.coordinatorRoleId?.trim()
    && opts.fromRoleId
    && opts.fromRoleId !== opts.coordinatorRoleId
  ) {
    return { triggered: false, error: 'not_coordinator' };
  }

  const task = pickScenarioTaskForRoom(await listTasks(scenarioId), scenarioId, content);
  if (!task) {
    return { triggered: false, error: 'no_task' };
  }

  const scenarios = await listScenarios();
  const scenario = scenarios.find((s) => s.id === scenarioId);
  if (!scenario) {
    return { triggered: false, error: 'scenario_not_found' };
  }

  if (task.status === 'running') {
    await abortOfficeTaskRun(task.id);
  }

  await clearTaskRunArtifacts(task.id, scenarioId);

  await appendRoomMessage({
    id: `room-${Date.now()}-rerun-reset`,
    projectId: task.id,
    scenarioId,
    from: 'system',
    content: `已根据群聊指令重新启动任务「${task.title}」。`,
    mentions: [],
    timestamp: Date.now(),
    taskId: task.id,
    phase: 'task_received',
  });

  const fresh = (await listTasks(scenarioId)).find((t) => t.id === task.id);
  if (!fresh) {
    return { triggered: false, error: 'task_not_found' };
  }

  void runOfficeTask(gateway, fresh, null, { mode: 'fresh', clearProjectRoom: true }).catch((err) => {
    console.warn('[office] room-triggered task rerun failed:', err);
  });

  return { triggered: true, taskId: fresh.id };
}
