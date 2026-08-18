/** Smart 群聊 Session 僵死 watchdog（毫秒）；`0` 或未设置表示关闭（保留 timeout=0 无上限）。 */
export function smartMentionStallWatchdogMs(): number {
  const raw =
    typeof process !== 'undefined' && process.env?.SMART_MENTION_STALL_MS
      ? process.env.SMART_MENTION_STALL_MS.trim()
      : '';
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Smart kickoff 连续失败多少次后标为 failed。 */
export const SMART_KICKOFF_MAX_FAIL_COUNT = 3;

/** assign 派活 follow-up 失败后，多久向协调者发引擎催办（毫秒）。 */
export const SMART_ASSIGN_DISPATCH_NUDGE_AFTER_MS = 300_000;
