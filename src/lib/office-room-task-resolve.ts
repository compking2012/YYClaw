import type { OfficeTempProject } from '@/types/office';

/** Strip list numbering prefix for title comparison (e.g. `1. 象棋开发`). */
export function normalizeTaskTitleForMatch(title: string): string {
  let t = title.trim();
  const seqMatch = t.match(/^\s*\d+\s*[.、:：)\]】]\s*(.+)$/);
  if (seqMatch?.[1]) t = seqMatch[1].trim();
  const stepMatch = t.match(/^\s*第\s*\d+\s*(?:步|阶段|章|节|轮)?\s*(.+)$/);
  if (stepMatch?.[1]) t = stepMatch[1].trim();
  return t;
}

/** Quoted or explicit task names from a room line (e.g. 任务「象棋游戏开发」). */
export function extractTaskTitleHintsFromRoomContent(content: string): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    const h = raw?.trim() ?? '';
    if (h.length < 2 || seen.has(h)) return;
    seen.add(h);
    hints.push(h);
  };

  for (const m of content.matchAll(/[「『]([^」』]+)[」』]/g)) add(m[1]);
  for (const m of content.matchAll(/[""]([^""]+)[""]/g)) add(m[1]);
  for (const m of content.matchAll(/['']([^'']+)['']/g)) add(m[1]);

  const execMatch = content.match(/执行任务\s*[「『""]?([^」』""\n。！？；;]+)[」』""]?/);
  add(execMatch?.[1]);

  return hints;
}

export function scoreTaskTitleMatch(taskTitle: string, hint: string): number {
  const t = normalizeTaskTitleForMatch(taskTitle);
  const h = normalizeTaskTitleForMatch(hint);
  if (!t || !h) return 0;
  if (t === h) return 10_000;
  if (t.includes(h)) {
    if (h.length < 4) return 0;
    return 5_000 + h.length;
  }
  if (h.includes(t)) return 4_000 + t.length;
  return 0;
}

const MIN_HINT_MATCH_SCORE = 5_000;

/** Match a task by explicit title in room content; null if no reliable hint. */
export function resolveTaskFromRoomContent(
  content: string,
  tasks: OfficeTempProject[],
): OfficeTempProject | null {
  if (tasks.length === 0) return null;

  let best: { task: OfficeTempProject; score: number } | null = null;
  for (const hint of extractTaskTitleHintsFromRoomContent(content)) {
    for (const task of tasks) {
      const score = scoreTaskTitleMatch(task.title, hint);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        best = { task, score };
      } else if (score === best.score) {
        const dBest = Math.abs(best.task.title.length - hint.length);
        const dTask = Math.abs(task.title.length - hint.length);
        if (dTask < dBest) best = { task, score };
      }
    }
  }
  if (best && best.score >= MIN_HINT_MATCH_SCORE) return best.task;

  const sorted = [...tasks].sort((a, b) => b.title.length - a.title.length);
  for (const task of sorted) {
    const norm = normalizeTaskTitleForMatch(task.title);
    if (norm.length < 2) continue;
    if (content.includes(norm)) return task;
    if (task.sequence != null && task.sequence >= 1) {
      const withSeq = `${task.sequence}. ${norm}`;
      if (content.includes(withSeq)) return task;
    }
  }

  return null;
}

export function pickScenarioTaskForRoom(
  tasks: (OfficeTempProject & { scenarioId?: string })[],
  parentGroupId: string,
  content?: string,
): OfficeTempProject | null {
  const scoped = tasks.filter((t) => {
    const groupId = t.parentGroupId ?? t.scenarioId;
    return groupId === parentGroupId;
  });
  if (scoped.length === 0) return null;

  if (content?.trim()) {
    const fromContent = resolveTaskFromRoomContent(content, scoped);
    if (fromContent) return fromContent;
  }

  const running = scoped.find((t) => t.status === 'running');
  if (running) return running;
  return [...scoped].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}
