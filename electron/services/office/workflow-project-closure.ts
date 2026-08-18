import type { GatewayManager } from '../../gateway/manager';
import { formatWorkflowClosureArchiveLine } from '../../../src/lib/office-workflow-closure-deliverables';
import type { NodeRunRecord, OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject, WorkflowNode } from './types';
import { roleMentionToken } from '../../../src/lib/office-mention';
import { workflowNodeAgentIds } from '../../../src/lib/office-workflow-node';
import { loadProjectExecutionMembers } from './office-execution-members';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import { postRoomAnnouncement } from './orchestrator';
import { getRoomMessages } from './store';
import {
  deliverablesBundlePublishSucceeded,
  findCoordinatorProjectClosureInRoomMessages,
  publishProjectDeliverablesBundleMessage,
} from './project-deliverables-bundle';
import { removeOfficeProjectSessionDir } from './office-project-session-dir';

function memberByAgentId(
  members: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>[],
  agentId: string,
): Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'> | undefined {
  return members.find((m) => m.agentId === agentId);
}

export function buildProjectClosureContent(params: {
  coordinator: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>;
  project: OfficeTempProject;
  nodes: WorkflowNode[];
  runs: Map<string, NodeRunRecord>;
  members: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>[];
}): { content: string; mentions: string[] } {
  const { coordinator, project, nodes, runs, members } = params;
  const lines: string[] = [
    `${coordinator.emoji ?? '🤖'} 【${coordinator.displayName}】📋 项目收尾 · ${project.title}`,
    '',
    '📂 内部归档（团队留存）',
  ];

  const completedRuns: {
    member: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>;
    node: WorkflowNode;
    run: NodeRunRecord;
  }[] = [];
  const failedRuns: {
    member: Pick<OfficeExecutionMember, 'agentId' | 'displayName' | 'emoji'>;
    node: WorkflowNode;
    run: NodeRunRecord;
  }[] = [];

  for (const node of nodes) {
    const run = runs.get(node.id);
    if (!run) continue;
    const nodeAgentIds = workflowNodeAgentIds(node);
    const member = memberByAgentId(members, nodeAgentIds[0] ?? run.agentId ?? '');
    if (!member) continue;
    if (run.status === 'completed' || run.status === 'skipped') {
      completedRuns.push({ member, node, run });
    } else if (run.status === 'failed') {
      failedRuns.push({ member, node, run });
    }
  }

  if (completedRuns.length === 0) {
    lines.push('（暂无已完成步骤产物）');
  } else {
    for (const { member, node, run } of completedRuns) {
      const step = node.title?.trim() || node.id;
      lines.push(formatWorkflowClosureArchiveLine(step, member.displayName, run.summary ?? ''));
    }
  }

  lines.push('', '📊 进展总结');
  const total = nodes.length;
  const ok = completedRuns.length;
  const fail = failedRuns.length;
  lines.push(`· 步骤：${ok}/${total} 完成${fail > 0 ? `，${fail} 失败` : ''}`);

  const mentions: string[] = [];
  if (failedRuns.length === 0) {
    lines.push('', '✅ 各成员顺利完成任务，本项目结束。');
  } else {
    const tokens = failedRuns.map(({ member }) => {
      mentions.push(member.agentId);
      return `@${roleMentionToken(member)}`;
    });
    lines.push('', `⚠️ 以下成员需修正后复检：${tokens.join(' ')}`);
    lines.push('请在群聊说明修正结果；理解有误的成员也请互相 @纠正。');
  }

  return { content: lines.join('\n'), mentions };
}

async function clearProjectSessionDirAfterSuccessfulBundle(
  project: OfficeTempProject,
  outcome: Awaited<ReturnType<typeof publishProjectDeliverablesBundleMessage>>,
): Promise<void> {
  if (!deliverablesBundlePublishSucceeded(outcome)) return;
  await removeOfficeProjectSessionDir(project);
}

export async function announceTaskProjectClosure(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): Promise<void> {
  const members = await loadProjectExecutionMembers(project);
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group);
  const coordinator = members.find((m) => m.agentId === coordinatorAgentId);
  if (!coordinator) return;

  const history = await getRoomMessages(project.id);
  const existingClosure = findCoordinatorProjectClosureInRoomMessages(
    history,
    project.id,
    coordinator.agentId,
  );
  if (existingClosure) {
    try {
      const outcome = await publishProjectDeliverablesBundleMessage(gateway, {
        groupId: group.id,
        project,
        afterMessageId: existingClosure.id,
        coordinatorAgentId,
        closure: existingClosure,
      });
      await clearProjectSessionDirAfterSuccessfulBundle(project, outcome);
    } catch (err) {
      console.warn('[office] project deliverables bundle failed:', err);
    }
    return;
  }

  const { content, mentions } = buildProjectClosureContent({
    coordinator,
    project,
    nodes,
    runs,
    members,
  });

  const closureMsg = await postRoomAnnouncement(gateway, {
    projectId: project.id,
    groupId: group.id,
    coordinatorAgentId,
    fromAgentId: coordinator.agentId,
    content,
    phase: 'project_closure',
    mentions,
    notifyMentionedAgents: mentions.length > 0,
  });

  try {
    const outcome = await publishProjectDeliverablesBundleMessage(gateway, {
      groupId: group.id,
      project,
      afterMessageId: closureMsg.id,
      coordinatorAgentId,
      closure: closureMsg,
    });
    await clearProjectSessionDirAfterSuccessfulBundle(project, outcome);
  } catch (err) {
    console.warn('[office] project deliverables bundle failed:', err);
  }
}
