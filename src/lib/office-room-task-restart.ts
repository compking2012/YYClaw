/** 协调者在群内明确要求「从 0 重启项目」的措辞（不含补充/迭代类需求）。 */
const FULL_RESTART_INTENT_RE =
  /重新执行|重新开始|重新跑|再跑一遍|带领大家|带队执行|忘记之前|重新开始.*任务|重新来|从头开始|从零开始|从\s*0\s*开始|rerun|re-run|restart.*task|run.*again/i;

/** 补充、局部变更等不算项目级重启。 */
const PARTIAL_WORK_EXCLUDE_RE =
  /补充(?:部分)?功能|部分功能|增补|追加需求|迭代开发|微调|优化一下|顺便(?:改|做)|在现有基础上|继续(?:完善|优化)|补丁/u;

/**
 * 群聊正文是否表达「从 0 重启当前项目」（须由协调者触发，见 triggerTaskRerunFromRoom）。
 */
export function roomMessageRequestsCoordinatorFullRestart(content: string): boolean {
  const t = content.trim();
  if (!t || PARTIAL_WORK_EXCLUDE_RE.test(t)) return false;
  return FULL_RESTART_INTENT_RE.test(t);
}

/** @deprecated 使用 {@link roomMessageRequestsCoordinatorFullRestart} */
export function roomMessageRequestsTaskRerun(content: string): boolean {
  return roomMessageRequestsCoordinatorFullRestart(content);
}
