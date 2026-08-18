/**
 * Smart 模式 · 成员 few-shot 样例（角色任务提示词见 office-smart-member-task-prompt）。
 */
import {
  buildSmartMemberAgentTaskPrompt,
  type SmartMemberTaskPromptParams,
} from '../../../../../src/lib/office-smart-member-task-prompt';

function fewShotLsFile(path: string, size = 1180): string {
  return `-rw-r--r--  1 demo  staff  ${size} May 26 10:00 ${path}`;
}

function fewShotLsDir(path: string): string {
  return `drwxr-xr-x  1 demo  staff  4096 May 26 10:00 ${path}`;
}

/** @deprecated 请使用 buildSmartMemberAgentTaskPrompt；保留供单测与静态预览。 */
export function buildSmartMemberRolePromptBlock(roleName = '产品'): string {
  return buildSmartMemberAgentTaskPrompt({
    roleName,
    coordinatorName: 'PM',
    task: {
      title: '示例项目',
      featureDescription: '示例功能描述。',
    },
    currentAssignment: '协调者指派示例子任务，完成后通过 dispatch 数组派给协调者验收。',
  });
}

export { buildSmartMemberAgentTaskPrompt, type SmartMemberTaskPromptParams };

const MEMBER_POSITIVE_DOC = JSON.stringify(
  {
    role: '产品',
    taskUnderstanding: '**需求规格说明书已完成** 已写入 requirements-产品.md，关键规则与验收标准均已整理。',
    action: 'end',
    deliverable: {
      items: ['交付物-产品/requirements-产品.md'],
      outputValidation: [fewShotLsFile('交付物-产品/requirements-产品.md')],
    },
    dispatch: [
      {
        role: 'PM',
        task: '请验收需求规格说明书，文件已落盘至 交付物-产品/requirements-产品.md。',
      },
    ],
  },
  null,
  2,
);

const MEMBER_POSITIVE_CODE = JSON.stringify(
  {
    role: '开发',
    taskUnderstanding: '**核心功能已完成** 交付物-开发/ 已自检，工程目录可运行。',
    action: 'end',
    deliverable: {
      items: ['交付物-开发/'],
      outputValidation: [fewShotLsDir('交付物-开发/')],
    },
    dispatch: [
      {
        role: 'PM',
        task: '请验收核心功能工程，交付目录为 交付物-开发/。',
      },
    ],
  },
  null,
  2,
);

const MEMBER_POSITIVE_HELP = JSON.stringify(
  {
    role: '性能优化',
    taskUnderstanding: '【依赖阻塞】上游算子源码与性能目标尚未提供，无法开展性能优化方案，请协调者补充输入。',
    action: 'help',
    deliverable: { items: [], outputValidation: [] },
    dispatch: [
      {
        role: 'PM',
        task: '请提供上游算子源码路径与具体性能目标，以便继续制定性能优化方案。',
      },
    ],
  },
  null,
  2,
);

export function buildSmartMemberFewShotBlock(): string {
  return [
    '【格式样例·成员】',
    '',
    '--- 正向 1 · 文档 ---',
    MEMBER_POSITIVE_DOC,
    '',
    '--- 正向 2 · 工程 ---',
    MEMBER_POSITIVE_CODE,
    '',
    '--- 正向 3 · 依赖求助 ---',
    MEMBER_POSITIVE_HELP,
    '',
    '--- 反例 ---',
    '{"taskUnderstanding":"开始写文档","action":"assign"}',
    '· 缺必填字段；成员 action 仅允许 end/help；成员不可 assign。',
  ].join('\n');
}
