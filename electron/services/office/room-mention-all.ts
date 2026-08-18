import type { OfficeRole, OfficeTask } from './types';
import { roleMatchesMentionToken } from './room-mentions';
import { workflowNodeHasRole } from '../../../src/lib/office-workflow-node';

export type AllMentionSelectionParams = {
  content: string;
  mentions: string[];
  focusTask: OfficeTask | null;
  coordinatorRoleId?: string;
  fromRoleId?: string;
};

export type AllMentionSelection = {
  /** 1–3 roles that must post effective feedback in the room. */
  primary: OfficeRole[];
  /** Other team members: notified only, no forced inline reply. */
  notify: OfficeRole[];
};

const COORDINATION_HINT =
  /协调|分工|进度|排期|分配|对齐|阻塞|风险|大家|团队|整体|推进|开工|同步/;

function extractKeywords(text: string): string[] {
  const words: string[] = [];
  for (const w of text.match(/[a-z][a-z0-9_-]{2,}/gi) ?? []) {
    words.push(w.toLowerCase());
  }
  for (const w of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    words.push(w);
  }
  return [...new Set(words)];
}

export function scoreRoleRelevanceForAllMention(
  role: OfficeRole,
  params: AllMentionSelectionParams,
): number {
  if (params.fromRoleId && params.fromRoleId === role.id) return -1_000;

  let score = 0;
  const text = params.content.toLowerCase();
  const name = role.name.trim().toLowerCase();
  const id = role.id.toLowerCase();

  if (name.length >= 2 && text.includes(name)) score += 28;
  if (id.length >= 2 && text.includes(id)) score += 20;

  for (const token of params.mentions) {
    if (roleMatchesMentionToken(role, token)) score += 55;
  }

  const task = params.focusTask;
  if (task) {
    const running = task.nodeRuns.find((n) => n.status === 'running');
    if (running?.agentId === role.agentId) score += 48;
    if (task.assignedRoleIds?.includes(role.id)) score += 14;

    const wf = task.workflow;
    if (wf) {
      for (const node of wf.nodes) {
        if (!workflowNodeHasRole(node, role.id)) continue;
        const title = (node.title ?? '').trim().toLowerCase();
        if (title.length >= 2 && text.includes(title)) score += 22;
        const desc = (node.description ?? '').toLowerCase();
        for (const kw of extractKeywords(params.content)) {
          if (kw.length >= 2 && (title.includes(kw) || desc.includes(kw))) score += 10;
        }
      }
    }
  }

  const keywords = extractKeywords(params.content);
  const desc = (role.description ?? '').toLowerCase();
  const lane = (role.laneContract ?? '').toLowerCase();
  for (const kw of keywords) {
    if (kw.length >= 2 && desc.includes(kw)) score += 11;
    if (kw.length >= 2 && lane.includes(kw)) score += 13;
  }

  if (params.coordinatorRoleId === role.id && COORDINATION_HINT.test(params.content)) {
    score += 14;
  }

  return score;
}

/** Pick 1–3 most relevant roles for @all; remaining team members are notify-only. */
export function selectPrimaryRolesForAllMention(
  teamRoles: OfficeRole[],
  params: AllMentionSelectionParams,
  opts?: { minPrimary?: number; maxPrimary?: number },
): AllMentionSelection {
  const minPrimary = Math.max(1, opts?.minPrimary ?? 1);
  const maxPrimary = Math.min(3, Math.max(minPrimary, opts?.maxPrimary ?? 3));

  if (teamRoles.length === 0) {
    return { primary: [], notify: [] };
  }

  const pool = params.coordinatorRoleId
    ? teamRoles.filter((r) => r.id !== params.coordinatorRoleId)
    : teamRoles;
  if (pool.length === 0) {
    return { primary: [], notify: [] };
  }

  const scored = pool
    .map((role) => ({ role, score: scoreRoleRelevanceForAllMention(role, params) }))
    .filter((x) => x.score > -500)
    .sort((a, b) => b.score - a.score || a.role.name.localeCompare(b.role.name));

  const positive = scored.filter((x) => x.score > 0).map((x) => x.role);
  const primary: OfficeRole[] = [];
  for (const role of positive) {
    if (primary.length >= maxPrimary) break;
    primary.push(role);
  }

  for (const { role } of scored) {
    if (primary.length >= minPrimary) break;
    if (primary.some((p) => p.id === role.id)) continue;
    primary.push(role);
  }

  if (primary.length === 0) {
    primary.push(...pool.slice(0, Math.min(maxPrimary, pool.length)));
  }

  const primaryIds = new Set(primary.map((r) => r.id));
  const notify = pool.filter((r) => !primaryIds.has(r.id));
  return { primary, notify };
}
