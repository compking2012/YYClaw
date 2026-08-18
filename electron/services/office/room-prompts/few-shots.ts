import type { OfficeTaskExecutionMode } from '../types';
import { buildSmartCoordinatorFewShotBlock } from './smart/coordinator-role-prompt';
import { buildSmartMemberFewShotBlock } from './smart/member-role-prompt';

export type RoomMentionFewShotRole =
  | 'member'
  | 'coordinator'
  | 'coordinator_unmentioned'
  | 'coordinator_missing_mention';

function formatExamples(title: string, examples: string[]): string {
  return [title, ...examples.map((ex, i) => `--- 样例 ${i + 1} ---\n${ex.trim()}`)].join('\n\n');
}

/** 群聊点名/协调者介入用 few-shot（JSON 格式，与 live Smart 校验一致）。 */
export function roomMentionFewShotBlock(
  executionMode: OfficeTaskExecutionMode,
  role: RoomMentionFewShotRole,
): string {
  if (executionMode === 'smart') {
    return smartFewShots(role);
  }
  return workflowFewShots(role);
}

function smartFewShots(role: RoomMentionFewShotRole): string {
  switch (role) {
    case 'member':
      return buildSmartMemberFewShotBlock();
    case 'coordinator':
      return buildSmartCoordinatorFewShotBlock();
    case 'coordinator_unmentioned':
      return formatExamples('【格式样例·Smart 协调者·广播介入】', [
        JSON.stringify(
          {
            role: 'PM',
            taskUnderstanding: '本步响应用户新需求广播，按工作顺序先由下一执行者评估。',
            inputValidation: '无',
            action: 'assign',
            deliverable: { items: [], outputValidation: [] },
            roomReply: '收到导出报表需求，将安排开发评估工时与实现范围。',
            dispatch: [
              {
                role: '开发',
                task: '周三前提交工时评估要点与实现范围说明；阻塞则通过 dispatch 向 PM 汇报。',
              },
            ],
          },
          null,
          2,
        ),
      ]);
    case 'coordinator_missing_mention':
      return formatExamples('【格式样例·Smart 协调者·补指派】', [
        JSON.stringify(
          {
            role: 'PM',
            taskUnderstanding: '本步补全开发发言中遗漏的测试指派，避免成员互 @ 派活。',
            inputValidation: '无',
            action: 'assign',
            deliverable: { items: [], outputValidation: [] },
            roomReply: '请测试对接开发联调分支，今日内完成冒烟用例草案。',
            dispatch: [
              {
                role: '测试',
                task: '覆盖登录/登出/异常码三条路径；验收标准：用例清单发群。',
              },
            ],
          },
          null,
          2,
        ),
      ]);
  }
}

function workflowFewShots(role: RoomMentionFewShotRole): string {
  switch (role) {
    case 'member':
      return formatExamples('【格式样例·Workflow 成员】', [
        [
          '【理解】协调者 @我执行「接口设计」步骤，前置 PRD 步骤已完成。',
          '【群聊回复】',
          '已阅读 PRD v3，接口清单与错误码草案今日下班前发群。',
          '完成后申请进入下一节点。',
        ].join('\n'),
        [
          '【理解】接口设计已完成，需测试接手评审。',
          '【群聊回复】',
          '接口清单与错误码已发群，请测试按 workflow 步骤接手。',
          '【分工】',
          '@测试 今日内完成接口可测性评审；阻塞项请 @协调者。',
        ].join('\n'),
      ]);
    case 'coordinator':
      return formatExamples('【格式样例·Workflow 协调者】', [
        [
          '【理解】用户催促整体进度，当前节点「开发」进行中。',
          '【群聊回复】',
          '开发节点按计划推进；测试节点待开发 on_success 后启动。',
          '【分工】',
          '@开发 今日完成剩余 API；@测试 预备用例，开发标记完成后立即接手。',
        ].join('\n'),
      ]);
    case 'coordinator_unmentioned':
      return formatExamples('【格式样例·Workflow 协调者·广播介入】', [
        [
          '【理解】成员已完成步骤通报，无待办。',
          '【判定】无需回应',
        ].join('\n'),
        [
          '【理解】用户追问进度，需按工作流说明下一步。',
          '【群聊回复】',
          '当前「开发」节点进行中；「测试」依赖开发成功边，预计明日切换。',
          '【分工】',
          '@开发 今日提交可测构建；@测试 关注群消息准备接手。',
        ].join('\n'),
      ]);
    case 'coordinator_missing_mention':
      return formatExamples('【格式样例·Workflow 协调者·补指派】', [
        [
          '【理解】产品发言需要测试评审但未 @测试。',
          '【群聊回复】',
          '@测试 请评审 @产品 刚发的验收标准，今日内回复是否可测及缺口。',
          '【分工】',
          '@测试 按 workflow 步骤「测试评审」执行；阻塞则 @协调者。',
        ].join('\n'),
      ]);
  }
}

/** 解析 few-shot 块中的「--- 样例 N ---」正文（供单测与引擎校验对齐）。 */
export function parseFewShotExamples(block: string): string[] {
  return block
    .split(/---\s*样例\s*\d+\s*---/iu)
    .slice(1)
    .map((s) => s.trim())
    .filter(Boolean);
}
