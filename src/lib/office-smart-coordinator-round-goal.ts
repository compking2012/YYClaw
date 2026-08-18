import type { SmartMemberReportToCoordinatorKind } from '@/lib/office-smart-member-reply';

export type CoordinatorRoundGoalParams = {
  promptVariant?: string;
  memberReportKind?: SmartMemberReportToCoordinatorKind;
  triggerFromUser?: boolean;
  smartUserMentionedMemberNames?: string[];
  needsDecomposition?: boolean;
  currentAssignableRoleNames?: string | null;
};

/** 协调者 3.2【本轮目标】：仅一条主指令。 */
export function buildCoordinatorRoundGoal(params: CoordinatorRoundGoalParams): string {
  const variant = params.promptVariant?.trim() ?? '';

  if (variant === 'coordinator_member_report') {
    return '本回合为处理成员汇报，须先根据【本回合触发】与 inputValidation 核验其交付/陈述，再决定验收、续派或返工。';
  }

  if (variant === 'coordinator_member_failure') {
    return '本回合为成员交付/格式异常处置：根据【本回合触发】决定返工或补交付，并 action="assign" 指派。';
  }

  if (variant === 'coordinator_member_supervision') {
    return '本回合为督办：对未正式 action="end" 汇报的成员 action="assign" 催促补交付或重新汇报。';
  }

  if (variant === 'coordinator_kickoff_decompose' || params.needsDecomposition) {
    return '本回合为项目 kickoff：将项目目标拆解为可执行子任务，action="assign" 指派第一阶段执行者。';
  }

  if (variant === 'coordinator_broadcast_unmentioned') {
    return '本回合为群聊无@发言：判断是否需要协调者跟进；无需跟进时 dispatch 写 []。';
  }

  if (variant === 'coordinator_user_mention_member') {
    const names = (params.smartUserMentionedMemberNames ?? []).filter(Boolean).join('、') || '成员';
    return `本回合用户点名 ${names}：由你裁决并 action="assign" 正式指派（成员不直接响应用户）。`;
  }

  if (variant === 'coordinator_missing_mention') {
    return '本回合为补指派：对本阶段执行者 action="assign" 补齐正式任务。';
  }

  if (params.triggerFromUser) {
    return '本回合为用户新诉求：须受理并按用户要求 action="assign" 安排可执行任务。';
  }

  void params.memberReportKind;
  void params.currentAssignableRoleNames;
  return '本回合为常规推进：结合历史进展验收或续派；全部子任务验收通过后方可 action="end"。';
}
