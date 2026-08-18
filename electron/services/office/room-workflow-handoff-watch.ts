import type { GatewayManager } from '../../gateway/manager';
import { membersForFixedGroup } from './office-member-resolve';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { NodeRunRecord, OfficeFixedGroup, OfficeTempProject, RoomMessage, WorkflowNode } from './types';
import {
  isValidWorkflowHandoffRoomMessage,
} from '../../../src/lib/office-workflow-handoff-compliance';
import {
  nextHandoffTargetsAfterNode,
  type WorkflowHandoffTarget,
} from '../../../src/lib/office-workflow-handoff';
import type { WorkflowDefinition } from './types';
import { getRoomMessages } from './store';
import { announceWorkflowHandoff } from './workflow-room-handoff';
import { resolveRoomCoordinatorMember } from './office-execution-members';
import { UNMENTIONED_RESPONSE_WAIT_MS } from './room-unmentioned-coordinator';

type HandoffWatch = {
  generation: number;
  taskId: string;
  nodeId: string;
  fromRoleId: string;
  deliverAfterMs: number;
  timer: NodeJS.Timeout;
  expected: WorkflowHandoffTarget[];
  resolve: () => void;
};

const watches = new Map<string, HandoffWatch>();
const pendingByTask = new Map<string, Set<Promise<void>>>();
let generationSeq = 0;

function watchKey(taskId: string, nodeId: string): string {
  return `${taskId}:${nodeId}`;
}

function finishWatch(key: string): void {
  const watch = watches.get(key);
  if (!watch) return;
  clearTimeout(watch.timer);
  watches.delete(key);
  watch.resolve();
}

function trackPending(taskId: string, promise: Promise<void>): void {
  let set = pendingByTask.get(taskId);
  if (!set) {
    set = new Set();
    pendingByTask.set(taskId, set);
  }
  set.add(promise);
  void promise.finally(() => {
    set!.delete(promise);
    if (set!.size === 0) pendingByTask.delete(taskId);
  });
}

export async function awaitOutstandingHandoffWatchesForTask(taskId: string): Promise<void> {
  const set = pendingByTask.get(taskId);
  if (!set || set.size === 0) return;
  await Promise.all([...set]);
}

export function cancelWorkflowHandoffWatch(taskId: string, nodeId: string): void {
  finishWatch(watchKey(taskId, nodeId));
}

/** 成员交付后已发有效 task_handoff 则取消兜底计时。 */
export function onRoomMessageWrittenForHandoffWatch(
  msg: RoomMessage,
  teamMembers: ProjectAgentRef[],
): void {
  const projectId = (msg.projectId ?? msg.taskId ?? '').trim();
  if (!projectId || !msg.nodeId?.trim()) return;
  if (msg.phase !== 'task_handoff') return;
  const key = watchKey(projectId, msg.nodeId);
  const watch = watches.get(key);
  if (!watch) return;
  if (msg.timestamp < watch.deliverAfterMs) return;
  if (!isValidWorkflowHandoffRoomMessage(msg.content, watch.expected, teamMembers)) return;
  finishWatch(key);
}

function roomHasValidHandoff(
  history: RoomMessage[],
  nodeId: string,
  sinceMs: number,
  expected: WorkflowHandoffTarget[],
  teamMembers: ProjectAgentRef[],
): boolean {
  return history.some(
    (m) =>
      m.nodeId === nodeId
      && m.phase === 'task_handoff'
      && m.timestamp >= sinceMs
      && isValidWorkflowHandoffRoomMessage(m.content, expected, teamMembers),
  );
}

export function scheduleWorkflowHandoffCoordinatorWatch(params: {
  gateway: GatewayManager;
  group: OfficeFixedGroup;
  project: OfficeTempProject;
  node: WorkflowNode;
  fromAgentId: string;
  workflow: Pick<WorkflowDefinition, 'nodes' | 'edges'>;
  runs: Map<string, NodeRunRecord>;
  expectedHandoff?: WorkflowHandoffTarget[];
}): Promise<void> {
  const expected =
    params.expectedHandoff
    ?? nextHandoffTargetsAfterNode(
      params.node.id,
      params.workflow.nodes,
      params.workflow.edges,
      params.runs,
      params.project.title,
    );
  if (expected.length === 0) return Promise.resolve();

  const key = watchKey(params.project.id, params.node.id);
  finishWatch(key);
  const generation = ++generationSeq;
  const deliverAfterMs = Date.now();

  const promise = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      void (async () => {
        const active = watches.get(key);
        if (!active || active.generation !== generation) return;

        try {
          const history = await getRoomMessages(params.project.id);
          const teamMembers = await membersForFixedGroup(params.group);
          if (
            roomHasValidHandoff(
              history,
              params.node.id,
              deliverAfterMs,
              expected,
              teamMembers,
            )
          ) {
            return;
          }

          const stillActive = watches.get(key);
          if (!stillActive || stillActive.generation !== generation) return;

          const { loadProjectExecutionMembers } = await import('./office-execution-members');
          const executionTeam = await loadProjectExecutionMembers(params.project);
          const coord = resolveRoomCoordinatorMember(params.group, executionTeam, params.project);
          if (!coord) return;

          const freshHistory = await getRoomMessages(params.project.id);
          if (
            roomHasValidHandoff(
              freshHistory,
              params.node.id,
              deliverAfterMs,
              expected,
              teamMembers,
            )
          ) {
            return;
          }

          const beforeAnnounce = watches.get(key);
          if (!beforeAnnounce || beforeAnnounce.generation !== generation) return;

          await announceWorkflowHandoff(
            params.gateway,
            params.group,
            params.project,
            params.node,
            coord,
            params.workflow,
            params.runs,
          );
        } catch (err) {
          console.warn('[office] workflow handoff coordinator fallback failed:', err);
        } finally {
          finishWatch(key);
        }
      })();
    }, UNMENTIONED_RESPONSE_WAIT_MS);

    watches.set(key, {
      generation,
      taskId: params.project.id,
      nodeId: params.node.id,
      fromRoleId: params.fromAgentId,
      deliverAfterMs,
      timer,
      expected,
      resolve,
    });
  });

  trackPending(params.project.id, promise);
  return promise;
}
