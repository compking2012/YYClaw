/**
 * Smart 模式 · 协调者 few-shot 样例（角色任务提示词见 office-smart-coordinator-task-prompt）。
 */
import {
  buildSmartCoordinatorAgentTaskPrompt,
  type SmartCoordinatorTaskPromptParams,
} from '../../../../../src/lib/office-smart-coordinator-task-prompt';

const FEW_SHOT_UPSTREAM =
  '/Users/demo/.openclaw/workspace-pm/office/projects/demo-task/requirements-产品.md';

function fewShotLs(path: string, size = 2048): string {
  return `-rw-r--r--  1 demo  staff  ${size} May 26 10:00 ${path}`;
}

const COORDINATOR_POSITIVE_1 = JSON.stringify(
  {
    role: 'PM',
    inputValidation: fewShotLs(FEW_SHOT_UPSTREAM),
    taskUnderstanding: '验收产品 **需求文档已完成** 汇报，ls 确认后续派开发。需求文档已验收，下一阶段进入核心功能实现。',
    action: 'assign',
    deliverable: { items: [], outputValidation: [] },
    dispatch: [
      {
        role: '开发',
        task: '基于 requirements-产品.md 实现核心功能，工程写入 交付物-开发/，完成后请求 PM 验收。',
      },
    ],
  },
  null,
  2,
);

const COORDINATOR_POSITIVE_2 = JSON.stringify(
  {
    role: 'PM',
    inputValidation: '无上一跳路径需 ls。',
    taskUnderstanding: '开发咨询优先级，答疑后不误派无关下游。本周先保登录与列表；支付对接待沙箱后再排。',
    action: 'assign',
    deliverable: { items: [], outputValidation: [] },
    dispatch: [
      {
        role: '开发',
        task: '本周优先完成登录与列表模块；支付对接暂缓至沙箱就绪。',
      },
    ],
  },
  null,
  2,
);

const COORDINATOR_NEGATIVE_BAD = JSON.stringify(
  {
    role: 'PM',
    taskUnderstanding: '错误示例：成员汇报后 dispatch 点名汇报者。需求文档已验收。',
    inputValidation: fewShotLs('requirements-产品.md'),
    action: 'assign',
    deliverable: { items: [], outputValidation: [] },
    dispatch: [
      { role: '产品', task: '请继续补充需求' },
    ],
  },
  null,
  2,
);

/** @deprecated 请使用 buildSmartCoordinatorAgentTaskPrompt；保留供单测与静态预览。 */
export function buildSmartCoordinatorRolePromptBlock(roleName = 'PM'): string {
  return buildSmartCoordinatorAgentTaskPrompt({
    roleName,
    coordinatorRoleId: 'pm',
    teammateNames: ['测试', '产品', '开发'],
    task: {
      title: '示例项目',
      featureDescription: '示例功能描述。',
    },
    currentTrigger: '成员汇报示例子任务已完成，请协调者验收并续派。',
    roomContext: '[1] 产品：**需求文档已完成** 已写入 requirements-产品.md。\n[2] PM：请 @开发 实现。',
  });
}

export { buildSmartCoordinatorAgentTaskPrompt, type SmartCoordinatorTaskPromptParams };

export function buildSmartCoordinatorFewShotBlock(): string {
  return [
    '【格式样例·协调者】正向可模仿，反例勿犯。',
    '',
    '--- 正向 1 · 验收后续派 ---',
    COORDINATOR_POSITIVE_1,
    '',
    '--- 正向 2 · 咨询后 assign 点名 ---',
    COORDINATOR_POSITIVE_2,
    '',
    '--- 反例 ---',
    COORDINATOR_NEGATIVE_BAD,
    '· 成员汇报后 dispatch 不得点名汇报者本人；须 @ 下一阶段执行者。',
  ].join('\n');
}
