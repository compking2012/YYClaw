import type { OfficeRole } from './types';

export function buildWorkflowGenerationPrompt(params: {
  description: string;
  teamRoles: OfficeRole[];
  taskTitle?: string;
  coordinatorRoleId?: string;
}): string {
  const roster = params.teamRoles
    .map((r) => `- ${r.name}（id: ${r.id}）${r.id === params.coordinatorRoleId ? '，协调者' : ''}`)
    .join('\n');

  const taskLine = params.taskTitle?.trim()
    ? `团队项目标题：${params.taskTitle.trim()}\n`
    : '';

  return [
    '你是办公协同工作流设计助手。根据用户的自然语言描述，将工作流拆分为 N 个可执行步骤。',
    '不要依赖固定模板或关键词映射；逐步理解用户原文，为每一步提取结构化字段。',
    '',
    taskLine + '用户描述：',
    params.description.trim(),
    '',
    '可用团队成员（who / roleNames 必须从下列名称或 id 中选择）：',
    roster,
    '',
    '输出要求：',
    '1. 只输出一个 JSON 对象，不要其它解释。可用 ```json 代码块包裹。',
    '2. JSON 结构：',
    '{',
    '  "mode": "dag",',
    '  "steps": [',
    '    {',
    '      "who": "执行该步的角色（单角色写名称，多角色用 + 连接，如 产品+开发+测试）",',
    '      "action": "做什么事（完整动作描述，保留用户原文要点）",',
    '      "output": "输出/交付物是什么（无则 null）",',
    '      "title": "从 action 提炼的 4～8 字步骤简称（可选，系统也会自动生成）",',
    '      "roleNames": ["产品", "开发"],',
    '      "parallelWithPrevious": false,',
    '      "rollbackToSteps": [],',
    '      "userCheckpoint": false',
    '    }',
    '  ]',
    '}',
    '3. steps 按用户描述中的先后顺序排列（编号 1、2、3… 或叙述先后）。每步必须填写 who、action；output 无则写 null。',
    '4. roleNames 与 who 一致：单角色写一项，多角色协作写全部参与角色。',
    '5. **多角色同一步协作**（如「产品+开发+测试 一起评审」「三方会签」）：只保留一个 step，who/roleNames 列出全部角色，parallelWithPrevious 为 false。',
    '6. **不同子任务并行**（如「与第5步并行」「与上一步并行」、两条独立工作线同时推进）：拆成多个 step，从第二条并行线起 parallelWithPrevious: true。',
    '7. **回滚边**：若某步失败需回到更早步骤（如「验收不通过回到第3步」「退回需求评审」），在该步 rollbackToSteps 填写目标步骤序号（1-based 整数数组）；无则 []。',
    '8. **用户审核节点**：若某步明确描述需要人工/用户审核、校验、干预、确认后再继续（如「此步需要人工审核」「需用户确认」「此步人工干预」），该步 userCheckpoint 设为 true；否则 false。此类说明属于流程约束，不要写进 action 正文，仅通过 userCheckpoint 表达。',
    '9. 步骤数量 2～12 步；无需填写单步耗时（系统默认 30 分钟）。',
    '10. 系统会按 steps 顺序与 parallelWithPrevious 生成 DAG：串行步骤前后衔接，并行步骤共享前驱，多角色同一步由多 Agent 协同完成；rollbackToSteps 生成 on_failure 回滚边；userCheckpoint 为 true 的步骤在运行时将暂停等待用户审核。',
  ].join('\n');
}
