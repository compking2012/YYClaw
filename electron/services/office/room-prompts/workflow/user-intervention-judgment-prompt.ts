import type { OfficeRole, OfficeScenario, OfficeTask, WorkflowNode } from '../../types';
import { mentionPromptContextBlock } from '../shared';
import { WORKFLOW_MENTION_RULES_BLOCK } from './blocks';

export function buildWorkflowCoordinatorUserInterventionPrompt(params: {
  coordinator: OfficeRole;
  scenario: Pick<OfficeScenario, 'name'>;
  task: OfficeTask;
  workflowNodes: WorkflowNode[];
  teammateNames: string[];
  userContent: string;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
}): string {
  const nodeCatalog = params.workflowNodes
    .map((n) => `- id=${n.id} | ${n.title?.trim() || '（无标题）'}`)
    .join('\n');

  const contextBlock = mentionPromptContextBlock({
    modeLabel: '【模式】Workflow · 用户介入判定',
    scenarioName: params.scenario.name,
    task: params.task,
    teammateNames: params.teammateNames,
    rulesBlock: WORKFLOW_MENTION_RULES_BLOCK,
    roomContext: params.roomContext,
    taskProgressContext: params.taskProgressContext,
    projectNotebookContext: params.projectNotebookContext,
    extraLines: [
      '【职责】成员子任务由 runner 自动执行；用户发言后由你判定是否需人工介入工作流。',
      '【路由】无论用户是否 @ 成员或 @ 协调者，成员均不直接回复用户；须由你输出 reply 并决定是否 needIntervention。',
      '【子任务目录】',
      nodeCatalog,
      '【用户原话】',
      `「${params.userContent.trim().slice(0, 2_000)}」`,
    ],
  });

  const schema = `{
  "needIntervention": boolean,
  "activeNodeId": string | null,
  "kind": "redo" | "skip_to" | "other",
  "skippedNodeId": string | null,
  "reason": string,
  "reply": string
}`;

  return `${contextBlock}

【角色】${params.coordinator.name}（协调者）

【输出要求】
仅输出一个 \`\`\`json 代码块，内容为下列 schema，勿输出其它段落或 @：
${schema}

字段说明：
- needIntervention=false：用户仅为进展通报/闲聊/已满足要求，无需改 DAG；reply 须写清理由并包含「无需干预」。
- needIntervention=true：须指定 activeNodeId（上表 id）；kind=redo 表示从该步重做；skip_to 时填 skippedNodeId 与 activeNodeId（跳过前者、执行后者）。系统会自动同步重开与该步并行且尚未完成的 sibling 步骤。
- reply：将发到项目群的用户可见说明（1–4 句）。

【判定原则】
- 含糊、未指向具体子任务且不影响交付 → 无需干预。
- 明确要求改某步、返工、跳过、重做、验收不通过等 → 需要干预并选对 nodeId。
- 项目状态为 completed / failed / aborted 时，若用户仍要求修改、返工、补做、跳过某步或追加变更，必须 needIntervention=true；不得因「项目已结束」判为无需干预。
- 仅当用户明确确认验收通过、无需再改、或纯闲聊/进展通报且无新诉求时，才可 needIntervention=false。`;
}
