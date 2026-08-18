/**
 * Prompt for decomposing a single user task into a dynamic workflow.
 *
 * Single-agent oriented: produces SUB-TASK steps (not roles, unlike the office
 * multi-agent generator). The model also acts as the suitability triage — it
 * returns `suitable:false` when the task is a simple one-shot Q&A with no clear
 * multi-step path, so the caller can fall back to a normal chat reply.
 */
export function buildDynamicWorkflowPrompt(
  task: string,
  skills?: Array<{ name: string; description?: string }>,
): string {
  const skillsSection = skills?.length
    ? [
        '',
        '已安装的技能（如果任务明显该交给其中某一个处理，不要自己拆步骤，直接返回',
        '{"suitable": false, "matchedSkill": "<对应技能名>"}，交给该技能自己执行）：',
        ...skills.map((s) => `- ${s.name}${s.description ? `：${s.description}` : ''}`),
      ]
    : [];
  return [
    '你是一个任务编排助手。判断下面的任务是否适合拆解成"执行路径清晰的多步骤工作流"，适合就拆解成有序子任务。',
    ...skillsSection,
    '',
    '用户任务：',
    task.trim(),
    '',
    '输出要求：',
    '1. 只输出一个 JSON 对象，可用 ```json 代码块包裹，不要任何其它解释。',
    '2. JSON 结构：',
    '{',
    '  "suitable": true,',
    '  "title": "整体任务简称（2-10 字）",',
    '  "steps": [',
    '    {',
    '      "id": "英文小写短标识（唯一，如 fetch）",',
    '      "title": "阶段简称（2-8 字，直接写内容，不要带"首先/其次/然后/最后/第一步"等引导词——顺序已经由列表位置决定）",',
    '      "goal": "让执行 Agent 在这一步完成什么（祈使句，说明产出）；可用 {{前序步骤id}} 引用上一步结果",',
    '      "inputsFrom": ["所依赖的前序步骤id"]',
    '    }',
    '  ]',
    '}',
    '3. 若任务只是简单问答、寒暄、单步即可完成、或没有清晰的多步执行路径：直接返回 {"suitable": false}。',
    '4. 适合时 steps 为 2~8 步，按真实执行先后排列；每步 goal 必须清楚、可独立执行。',
    '5. 当某步需要用到前面步骤的产出时，在 goal 文本中用 {{对应步骤id}} 占位，并在 inputsFrom 中列出这些 id。',
    '6. id 仅用小写字母/数字/下划线，且全局唯一。',
    '7. 默认每一步都由一个具备工具能力的 Agent 执行，无需填写步骤类型。',
  ].join('\n');
}
