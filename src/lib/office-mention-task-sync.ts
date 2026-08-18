import type { OfficeScenario, OfficeTask, RoomMessagePhase } from '@/types/office';
import { taskExecutionMode } from '@/lib/office-task-execution-mode';
import { workflowForTask } from '@/lib/office-task-workflow';
import { findWorkflowSpeakerNodeId } from '@/lib/office-workflow-upstream-mention';

export function inferPhaseFromRoleReplyContent(
  content: string,
  executionMode?: 'smart' | 'workflow',
): RoomMessagePhase {
  const t = content.trim();
  if (executionMode === 'smart') {
    // Smart：成员验收「验收通过」不是项目结项；仅明确结项语义才标 project_closure。
    if (/【结项】|项目结项|正式结项|项目已完成|全部子任务.*结项|已在.*结项/u.test(t)) {
      return 'project_closure';
    }
    if (/验收通过/u.test(t)) return 'task_team_review';
  } else if (/项目完成|全部完成|验收通过|结案/i.test(t)) {
    return 'project_closure';
  }
  if (
    /需求文档已完成|文档已完成|PRD.*完成|产品需求.*完成|需求分析.*✅|M\d+[^|\n]*✅/i.test(t)
  ) {
    return 'task_deliver';
  }
  if (/已修订|已补充|已完成|交付|需求.*完整|\*\*已完成\*\*/i.test(t)) return 'task_deliver';
  if (/✅/.test(t) && /完成|已就位|已补充|已修订/.test(t)) return 'task_deliver';
  if (/进行中|实施中|🔄|处理中|编写代码|M\d+.*进行中|待开始/i.test(t)) return 'task_running';
  if (/理解|收到|接受|确认/i.test(t)) return 'task_understanding';
  return 'task_clarification';
}

export function progressSnippetFromRoleReply(content: string, maxLen = 200): string {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /进度|状态|✅|🔄|进行中|完成|步骤/i.test(l));
  const line = hit ?? lines[0] ?? content;
  const trimmed = line.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/** Tags a @mention reply for the team room; nodeRuns sync via store reconcile. */
export function mentionReplyRoomMeta(
  task: OfficeTask,
  scenario: Pick<OfficeScenario, 'workflow'>,
  roleId: string,
  content: string,
): {
  phase: RoomMessagePhase;
  nodeId?: string;
  progressSnippet: string;
  taskId: string;
} {
  const workflow = workflowForTask(task, scenario);
  const nodeId =
    taskExecutionMode(task) === 'workflow'
      ? findWorkflowSpeakerNodeId({
          nodeRuns: task.nodeRuns,
          nodes: workflow.nodes,
          speakerRoleId: roleId,
          content,
        })
      : undefined;
  return {
    phase: inferPhaseFromRoleReplyContent(content, taskExecutionMode(task)),
    nodeId,
    progressSnippet: progressSnippetFromRoleReply(content),
    taskId: task.id,
  };
}
