import { roleMatchesMentionToken } from '@/lib/office-mention-parse';
import type {
  LangGraphConditionalRoute,
  LangGraphOrchestrationPlan,
  LangGraphPlanEdge,
  LangGraphPlanNode,
  LangGraphSubgraph,
  LangGraphVisualLayer,
} from '@/lib/office-langgraph-plan-types';
import { DEFAULT_NODE_MAX_RUNTIME_MINUTES } from '@/lib/office-workflow-roles';
import {
  inferDeliverableStemFromSegment,
  stripWorkflowStepDeliveryClauses,
} from '@/lib/office-workflow-deliverable-naming';
import {
  enrichWorkflowGenerationStepsUserCheckpoint,
  inferUserCheckpointFromStepText,
  stripUserCheckpointCueClauses,
} from '@/lib/office-workflow-user-checkpoint-infer';
import { syncWorkflowEdges, validateWorkflowEdges } from '@/lib/office-workflow-edges';
import {
  normalizeWorkflowNodeAgents,
  type ProjectAgentRef,
} from '@/lib/office-workflow-node';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@/types/office';

/** Agent roster entry for workflow generation (id === agentId). */
export type WorkflowGenMember = ProjectAgentRef & { id: string; name: string };

export function workflowGenMembersFromRefs(members: ProjectAgentRef[]): WorkflowGenMember[] {
  return members.map((m) => ({ ...m, id: m.agentId, name: m.displayName }));
}

function normalizeWorkflowGenTeam(teamRoles: WorkflowGenMember[]): WorkflowGenMember[] {
  return teamRoles.map((r) => {
    const id = (r.id ?? r.agentId ?? '').trim();
    const name = (r.name ?? r.displayName ?? id).trim();
    return { ...r, id, name, agentId: id, displayName: name };
  });
}

function workflowRoleMatchesToken(role: WorkflowGenMember, token: string): boolean {
  return roleMatchesMentionToken(
    { agentId: role.id, displayName: role.name },
    token,
  );
}

/** LLM / heuristic intermediate representation before materializing nodes & edges. */
export interface WorkflowGenerationStepDraft {
  title: string;
  description?: string;
  /** 原始步骤文本（用于提取回滚条件等语义）。 */
  rawText?: string;
  /** 执行角色（模型拆分字段，与 roleNames 对应） */
  who?: string;
  /** 做什么事（模型拆分字段） */
  action?: string;
  /** 输出/交付物（模型拆分字段） */
  output?: string | null;
  /** Role display names or ids */
  roleNames: string[];
  /** Parallel with the previous step (fork after same predecessor). */
  parallelWithPrevious?: boolean;
  /** 1-based step index to run parallel with (when not the immediate previous step). */
  parallelWithStepNumber?: number;
  /** 失败时回滚到的步骤序号（1-based，模型拆分字段） */
  rollbackToStepNumbers?: number[];
  /** Max wall-clock minutes for this step (default 30). */
  maxRuntimeMinutes?: number;
  /** Pause for user review after this step completes. */
  userCheckpoint?: boolean;
}

export interface WorkflowGenerationDraft {
  mode?: 'simple' | 'dag';
  steps: WorkflowGenerationStepDraft[];
}

export type WorkflowGenerateSource =
  | 'heuristic'
  | 'ai'
  | 'ai_fallback'
  | 'langgraph_heuristic'
  | 'langgraph_ai'
  | 'langgraph_ai_fallback';

export interface WorkflowGenerateResult {
  workflow: WorkflowDefinition;
  mode: 'simple' | 'dag';
  source: WorkflowGenerateSource;
  summary: string;
}

/** Fork step N with step N-1 (e.g. 「与5并行」) — not in-step 「一起评审」. */
const PARALLEL_WITH_PREVIOUS_RE =
  /与\s*(?:第?\s*)?(\d+|[一二三四五六七八九十百千]+)\s*(?:步|项)?\s*并行|与\s*上(?:一)?\s*步\s*并行/u;

const JOINT_STEP_RE =
  /[+＋].*(?:三方|联合|会签)|(?:三方|联合).*(?:评审|讨论|确认|对齐)|(?:一起|共同|协同|会签).*(?:评审|讨论|确认|对齐)|联合.*(?:评审|讨论)/u;

const ROLE_HINTS: { pattern: RegExp; tokens: string[] }[] = [
  { pattern: /产品经理/u, tokens: ['产品经理'] },
  { pattern: /(?<!软件)产品(?!经理)/u, tokens: ['产品'] },
  { pattern: /需求/u, tokens: ['产品', '需求'] },
  { pattern: /软件开发|研发|工程/u, tokens: ['开发', '研发', '工程师'] },
  { pattern: /测试|QA|质量/u, tokens: ['测试', 'qa', '质量'] },
  { pattern: /设计|UI|UX/u, tokens: ['设计', 'ui', 'ux'] },
];

/** 从步骤原文解析：谁、做什么事、输出是什么。 */
export interface ParsedWorkflowStepFields {
  who: string;
  action: string;
  output: string | null;
}

const ROLE_TOKEN =
  'PM|产品(?:经理)?|软件开发|软件研发|(?:软件)?测试|开发|数据搜集师|数据收集师';

const LEADING_WHO_RE = new RegExp(
  `^(?:${ROLE_TOKEN})(?:(?:[+＋]|[、,，]\\s*)(?:${ROLE_TOKEN}))*(?:(?:三方|一起|共同|协同|并行)\\s*)+`,
  'u',
);

const LEADING_WHO_SINGLE_RE = new RegExp(
  `^(?:${ROLE_TOKEN})(?:(?:[+＋]|[、,，]\\s*)(?:${ROLE_TOKEN}))*\\s*`,
  'u',
);

const ACTION_VERB_RE =
  /(编写|撰写|评审|实现|验收|总结|搜集|收集|修改|发布|组织|设计|验证|梳理|提出|完成|测试)/u;

const SUMMARY_VERBS =
  '编写|撰写|评审|实现|验收|总结|搜集|收集|修改|发布|组织|设计|验证|梳理|提出|完成|进行|测试';

const PM_MENTION_RE = /(?:^|[\s，,;；、（(【「])PM(?=[\s，,;；、）)】」编写组织负责收]|$)/u;
const ROLLBACK_CUE_RE = /(?:结论|验收|审计|测试)?.{0,8}(?:不通过|未通过|失败|不满足|未达标)/u;
const ROLLBACK_TO_STEP_RE =
  /(?:回到|返回|退回|回滚(?:至|到)?|重回|重新(?:回到|进入)|回)(?:\s*第?\s*)?(\d+|[一二三四五六七八九十百千两]+)/gu;

function cleanStepLine(line: string): string {
  return line
    .replace(/^[\s\-*•]+/u, '')
    .replace(
      /^(?:\d+[.、)\]]\s*|第[一二三四五六七八九十百千]+[步段节][：:\s]+)/u,
      '',
    )
    .trim();
}

function parseChineseStepNumber(token: string): number | null {
  const t = token.trim();
  if (!t) return null;
  if (/^\d+$/u.test(t)) {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (t === '十') return 10;
  const thousands = t.match(/([一二三四五六七八九两])千/u);
  const hundreds = t.match(/([一二三四五六七八九两])百/u);
  const tens = t.match(/([一二三四五六七八九两]?)十/u);
  const ones = t.match(/([一二三四五六七八九两])$/u);
  let out = 0;
  if (thousands?.[1]) out += (digitMap[thousands[1]] ?? 0) * 1000;
  if (hundreds?.[1]) out += (digitMap[hundreds[1]] ?? 0) * 100;
  if (t.includes('十')) {
    const lead = tens?.[1] ? (digitMap[tens[1]] ?? 0) : 1;
    out += lead * 10;
  }
  if (ones?.[1] && !/十$|百$|千$/u.test(t)) out += digitMap[ones[1]] ?? 0;
  return out > 0 ? out : null;
}

function inferRollbackStepNumbers(segment: string): number[] {
  const text = segment.trim();
  if (!text || !ROLLBACK_CUE_RE.test(text)) return [];
  const out: number[] = [];
  for (const m of text.matchAll(ROLLBACK_TO_STEP_RE)) {
    const n = parseChineseStepNumber(m[1] ?? '');
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export function splitDescriptionToSegments(description: string): string[] {
  const text = description.trim();
  if (!text) return [];

  const lines = text
    .split(/\n+/u)
    .map(cleanStepLine)
    .filter((l) => l.length > 0);
  if (lines.length > 1) return lines;

  if (/\d+[.、)]/u.test(text) && /[;；]/.test(text)) {
    const bySemicolon = text
      .split(/[;；]+/u)
      .map(cleanStepLine)
      .filter((l) => l.length >= 2);
    if (bySemicolon.length > 1) return bySemicolon;
  }

  const numbered = text
    .split(/(?=(?:\d+[.、)\]]\s*|第[一二三四五六七八九十百千]+[步段节][：:\s]))/gu)
    .map(cleanStepLine)
    .filter((l) => l.length >= 2);
  if (numbered.length > 1) return numbered;

  const byArrow = text
    .split(/(?:→|->|=>|然后|接着|之后|再)/u)
    .map(cleanStepLine)
    .filter((l) => l.length >= 2);
  if (byArrow.length > 1) return byArrow;

  return [text];
}

/** Strip trailing deliverable clause so titles stay phase-oriented. */
export function stripDeliveryClause(segment: string): string {
  return stripWorkflowStepDeliveryClauses(segment);
}

function stripStepConditionPrefix(text: string): string {
  return text
    .replace(/^在\s*\d+\s*完成之后[，,]/u, '')
    .replace(/^(?:PM|产品经理|产品|软件开发|软件研发|测试|开发)?收到.+?后[，,]/u, '')
    .trim();
}

function splitWhoAndAction(body: string): { who: string; action: string } {
  const text = stripStepConditionPrefix(body);
  const verbMatch = text.match(ACTION_VERB_RE);
  if (!verbMatch || verbMatch.index === undefined) {
    return { who: '', action: text };
  }

  let who = text.slice(0, verbMatch.index).trim();
  const action = text.slice(verbMatch.index).trim();
  who = who
    .replace(/(?:三方|一起|共同|协同|并行)\s*$/u, '')
    .replace(/[，,]\s*$/u, '')
    .trim();
  return { who, action };
}

/** 从单步描述提取「谁」「做什么事」「输出是什么」。 */
export function parseWorkflowStepFields(segment: string): ParsedWorkflowStepFields {
  const raw = segment.replace(/[；;]\s*与\s*\d+\s*并行\s*$/u, '').trim();
  const output = inferDeliverableStemFromSegment(raw);
  const body = stripStepConditionPrefix(
    cleanStepLine(stripWorkflowStepDeliveryClauses(raw)),
  );

  const leading =
    body.match(LEADING_WHO_RE) ?? body.match(LEADING_WHO_SINGLE_RE);
  if (leading) {
    const who = leading[0].trim();
    return {
      who,
      action: body.slice(leading[0].length).trim() || body,
      output,
    };
  }

  const { who, action } = splitWhoAndAction(body);
  return { who, action: action || body, output };
}

const ACTION_TITLE_TOKEN_RE = /[\p{Script=Han}]+|[A-Za-z0-9]+/gu;

const ACTION_TITLE_VERSION_QUALIFIERS = new Set([
  '初稿',
  '定稿',
  '终稿',
  '草案',
  '修订稿',
  '草稿',
  '正稿',
]);

/** 宾语核心词尾（交付物/工作对象类型）。 */
const ACTION_TITLE_CORE_HEAD_SUFFIX_RE =
  /(?:策划案|计划书|说明书|意见|预算|计划|报告|方案|总结|用例|清单|记录|规范|标准|流程|设计|材料|文档|模块|功能|系统|稿|案|书)$/u;

/** 修饰语（描述载体/风格/范围，非复合名词本体）。 */
const ACTION_TITLE_DESCRIPTIVE_MODIFIER_RE =
  /^(?:相关|权威|各类|各种|有关|对应|指定|最新|主要|核心|漫画|详细|完整|初步|深度|新版|旧版|现有|全部|部分)$/u;

const ACTION_TITLE_HAN_PEEL_PATTERNS = [
  ...ACTION_TITLE_VERSION_QUALIFIERS,
  '材料和数据',
  '相关材料',
  '相关数据',
  '策划案',
  '计划书',
  '说明书',
  '需求说明书',
  '项目预算',
  '测试用例',
  '预算',
  '计划',
  '报告',
  '方案',
  '总结',
  '用例',
  '意见',
  '材料',
  '数据',
  '文档',
  '清单',
  '记录',
  '规范',
  '标准',
  '流程',
  '设计',
  '模块',
  '功能',
  '系统',
] as const;

function decomposeHanPhrase(text: string): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > 0) {
    let peeled: string | null = null;
    for (const pattern of ACTION_TITLE_HAN_PEEL_PATTERNS) {
      const token = String(pattern);
      if (rest.endsWith(token) && rest.length > token.length) {
        peeled = token;
        rest = rest.slice(0, -token.length);
        break;
      }
    }
    if (!peeled) {
      parts.unshift(rest);
      break;
    }
    parts.unshift(peeled);
  }
  return parts.filter((part) => part.length > 0);
}

function expandActionTitleToken(token: string): string[] {
  if (/^[A-Za-z0-9]+$/u.test(token)) return [token];
  if (token.length <= 2) return [token];
  const parts = decomposeHanPhrase(token);
  return parts.length > 1 ? parts : [token];
}

function tokenizeActionClause(clause: string): string[] {
  const raw = clause.match(ACTION_TITLE_TOKEN_RE) ?? [];
  return raw.flatMap(expandActionTitleToken);
}

function isActionTitleAttributeModifier(token: string): boolean {
  return /^[A-Za-z0-9]+$/u.test(token) || ACTION_TITLE_DESCRIPTIVE_MODIFIER_RE.test(token);
}

function isActionTitleGenericTailToken(token: string): boolean {
  return /^(?:材料|数据|信息|内容|资料|文件|文档|详情)$/u.test(token)
    || /^和?(?:材料|数据)/u.test(token)
    || /(?:材料|数据)和/u.test(token);
}

/** 从动作宾语词元中提取核心对象（去掉修饰语与版本/泛化尾词）。 */
function extractActionCoreObject(tokens: string[]): string {
  if (tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0]!;

  let working = [...tokens];
  while (working.length > 1 && ACTION_TITLE_VERSION_QUALIFIERS.has(working[working.length - 1]!)) {
    working.pop();
  }
  while (working.length > 1 && isActionTitleGenericTailToken(working[working.length - 1]!)) {
    working.pop();
  }
  if (working.length === 0) return tokens.join('');

  let headIdx = -1;
  for (let i = working.length - 1; i >= 0; i--) {
    if (ACTION_TITLE_CORE_HEAD_SUFFIX_RE.test(working[i]!)) {
      headIdx = i;
      break;
    }
  }

  if (headIdx >= 0) {
    const head = working[headIdx]!;
    const beforeHead = working.slice(0, headIdx);
    const hasAttributeModifiers = beforeHead.some(isActionTitleAttributeModifier);
    if (hasAttributeModifiers) return head;
    return working.slice(0, headIdx + 1).join('');
  }

  return working.join('');
}

function composeActionTitle(leading: string, trailing: string, min: number, max: number): string {
  const trimmedTrailing = trailing.replace(/[的了吗着并]$/u, '').trim();
  let title = `${leading}${trimmedTrailing}`.replace(/[的了吗着并]$/u, '').trim();
  if (title.length >= min && title.length <= max) return title;

  if (title.length > max) {
    const allowedLeadingLen = Math.max(1, max - trimmedTrailing.length);
    const shrunkLeading = leading.slice(-allowedLeadingLen);
    title = `${shrunkLeading}${trimmedTrailing}`.replace(/[的了吗着并]$/u, '').trim();
    if (title.length >= min && title.length <= max) return title;
    return title.slice(0, max);
  }

  if (title.length < min && leading.length > 0) {
    const pad = leading.slice(0, max - trimmedTrailing.length);
    title = `${pad}${trimmedTrailing}`.trim();
    if (title.length >= min) return title;
  }

  return title.length > 0 ? title : leading.slice(0, max) || '步骤';
}

/** 从「做什么事」生成 4～8 字步骤名称摘要（动词 + 核心宾语，去掉修饰语）。 */
export function summarizeActionTitle(action: string): string {
  const MIN = 4;
  const MAX = 8;

  let normalized = action.trim();
  if (!normalized) return '步骤';

  normalized = normalized
    .replace(/^针对.+?(?:进行|的意见)/u, '')
    .replace(/^根据.+?(?:进行|完成)/u, '')
    .replace(/^对[^，,。；;]{1,16}(?:进行|完成)[，,]?/u, '')
    .replace(/^进行/u, '')
    .trim();
  if (!normalized) normalized = action.trim();

  const firstClause = (normalized.split(/[，,。；;]/u)[0] ?? normalized).trim();

  const headVerb = firstClause.match(new RegExp(`^(${SUMMARY_VERBS})`, 'u'));
  if (headVerb) {
    const verb = headVerb[1]!;
    const rest = firstClause.slice(verb.length).trim();
    const object = extractActionCoreObject(tokenizeActionClause(rest));
    if (object) return composeActionTitle(verb, object, MIN, MAX);
  }

  const tailVerb = firstClause.match(
    /(.+?)(编写|撰写|评审|实现|验收|总结|搜集|收集|修改|发布|验证|梳理|测试)$/u,
  );
  if (tailVerb) {
    const prefix = tailVerb[1] ?? '';
    const verb = tailVerb[2] ?? '';
    const object = extractActionCoreObject(tokenizeActionClause(prefix));
    if (object) return composeActionTitle(object, verb, MIN, MAX);
  }

  const object = extractActionCoreObject(tokenizeActionClause(firstClause));
  if (object.length >= MIN) return object.length <= MAX ? object : object.slice(0, MAX);

  if (firstClause.length >= MIN) return firstClause.slice(0, MAX);
  return normalized.slice(0, MAX) || '步骤';
}

export function inferStepTitle(segment: string, primaryRoleName?: string): string {
  const parsed = parseWorkflowStepFields(segment);
  let action = parsed.action;
  if (!parsed.who && primaryRoleName) {
    const escaped = primaryRoleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    action = action.replace(new RegExp(`^${escaped}\\s*`, 'u'), '').trim();
  }
  return summarizeActionTitle(action || stripDeliveryClause(segment));
}

export function resolveRoleIdsFromTokens(
  tokens: string[],
  teamRoles: WorkflowGenMember[],
): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    for (const role of teamRoles) {
      if (workflowRoleMatchesToken(role, token) && !out.includes(role.id)) {
        out.push(role.id);
      }
    }
  }
  return out;
}

function normalizePlusRolePart(part: string): string {
  return part
    .replace(/^(?:一起|共同|协同|并行)\s*/u, '')
    .split(/(?:三方|一起|共同|协同|并行|评审|讨论)/u)[0]!
    .trim();
}

function parseEnumeratedRoleNames(text: string): string[] {
  if (!/[+＋]|[、,，]/u.test(text)) return [];
  const parts = text
    .split(/[+＋]|[、,，]\s*/u)
    .map(normalizePlusRolePart)
    .filter((p) => p.length > 0 && p.length <= 24);
  if (parts.length < 2) return [];
  return parts;
}

function addRoleId(found: string[], roleId: string): void {
  if (!found.includes(roleId)) found.push(roleId);
}

export function matchRolesInText(text: string, teamRoles: WorkflowGenMember[]): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();

  const plusParts = parseEnumeratedRoleNames(text);
  if (plusParts.length >= 2) {
    for (const part of plusParts) {
      const ids = resolveRoleIdsFromTokens([part], teamRoles);
      if (ids[0]) addRoleId(found, ids[0]!);
      else {
        const fromName = teamRoles.find(
          (r) => r.name === part || r.name.includes(part) || part.includes(r.name),
        );
        if (fromName) addRoleId(found, fromName.id);
      }
    }
    if (found.length >= 2) return found;
    found.length = 0;
  }

  const sortedRoles = [...teamRoles].sort(
    (a, b) => b.name.trim().length - a.name.trim().length,
  );
  for (const role of sortedRoles) {
    const name = role.name.trim();
    if (name.length >= 2 && (text.includes(name) || name.includes(text))) {
      addRoleId(found, role.id);
    }
  }

  if (PM_MENTION_RE.test(text)) {
    const pmRole =
      teamRoles.find((r) => /^pm$/iu.test(r.name.trim())) ??
      teamRoles.find((r) => workflowRoleMatchesToken(r, 'pm'));
    if (pmRole) addRoleId(found, pmRole.id);
  }

  if (found.length === 0) {
    for (const role of teamRoles) {
      if (workflowRoleMatchesToken(role, lower)) addRoleId(found, role.id);
    }
  }

  if (found.length === 0) {
    for (const hint of ROLE_HINTS) {
      if (!hint.pattern.test(text)) continue;
      for (const token of hint.tokens) {
        if (!text.toLowerCase().includes(token.toLowerCase()) && !text.includes(token)) continue;
        const ids = resolveRoleIdsFromTokens([token], teamRoles);
        for (const id of ids) addRoleId(found, id);
      }
    }
  }

  return found;
}

export function inferParallelWithPrevious(segment: string): boolean {
  return PARALLEL_WITH_PREVIOUS_RE.test(segment);
}

export function inferJointMultiRole(segment: string, roleIds: string[]): boolean {
  if (roleIds.length <= 1) return false;
  if (/[+＋]|[、,，]/u.test(segment) && roleIds.length >= 2) return true;
  return JOINT_STEP_RE.test(segment);
}

export function pickPrimaryRoleId(
  segment: string,
  roleIds: string[],
  teamRoles: WorkflowGenMember[],
): string {
  if (roleIds.length === 0) return '';
  if (roleIds.length === 1) return roleIds[0]!;

  let bestIdx = Number.POSITIVE_INFINITY;
  let bestId = roleIds[0]!;
  for (const id of roleIds) {
    const name = teamRoles.find((r) => r.id === id)?.name.trim() ?? '';
    if (!name) continue;
    const idx = segment.indexOf(name);
    if (idx >= 0 && idx < bestIdx) {
      bestIdx = idx;
      bestId = id;
    }
  }
  if (bestIdx < Number.POSITIVE_INFINITY) return bestId;

  if (PM_MENTION_RE.test(segment)) {
    const pm = roleIds.find((id) => {
      const name = teamRoles.find((r) => r.id === id)?.name.trim() ?? '';
      return /^pm$/iu.test(name);
    });
    if (pm) return pm;
  }

  return roleIds[0]!;
}

/** Merge consecutive heuristic steps that resolved to the same phase title (e.g. duplicate 需求评审). */
export function collapseDuplicatePhaseSteps(
  steps: WorkflowGenerationStepDraft[],
): WorkflowGenerationStepDraft[] {
  const out: WorkflowGenerationStepDraft[] = [];
  for (const step of steps) {
    const prev = out[out.length - 1];
    if (prev && prev.title.trim() === step.title.trim()) {
      const roleNames = [...new Set([...prev.roleNames, ...step.roleNames])];
      out[out.length - 1] = {
        title: prev.title,
        description: [prev.description, step.description].filter(Boolean).join('\n'),
        rawText: [prev.rawText, step.rawText].filter(Boolean).join('\n'),
        roleNames,
        parallelWithPrevious: prev.parallelWithPrevious,
        userCheckpoint: prev.userCheckpoint === true || step.userCheckpoint === true,
      };
      continue;
    }
    out.push(step);
  }
  return out;
}

export function buildHeuristicWorkflowDraft(
  description: string,
  teamRoles: WorkflowGenMember[],
): WorkflowGenerationDraft | null {
  const roster = normalizeWorkflowGenTeam(teamRoles);
  if (!description.trim() || roster.length === 0) return null;

  const segments = splitDescriptionToSegments(description);
  const steps: WorkflowGenerationStepDraft[] = [];
  let roleCursor = 0;

  for (const segment of segments) {
    const parsed = parseWorkflowStepFields(segment);
    const roleLookupText = parsed.who || segment;
    let roleIds = matchRolesInText(roleLookupText, roster);
    if (roleIds.length === 0) {
      roleIds = matchRolesInText(segment, roster);
    }
    const parallelWithPrevious = inferParallelWithPrevious(segment);

    if (roleIds.length === 0) {
      roleIds = [roster[roleCursor % roster.length]!.id];
      roleCursor += 1;
    }

    const joint = inferJointMultiRole(segment, roleIds);
    const stepRoleIds = joint ? roleIds : [pickPrimaryRoleId(segment, roleIds, roster)];
    const stepRoleNames = stepRoleIds.map(
      (id) => roster.find((r) => r.id === id)?.name ?? id,
    );

    const userCheckpoint = inferUserCheckpointFromStepText(segment);
    let action = parsed.action;
    if (userCheckpoint) {
      action = stripUserCheckpointCueClauses(action);
    }

    const description = parsed.output
      ? `${action}（输出：${parsed.output}）`
      : action;

    steps.push({
      title: summarizeActionTitle(action),
      description,
      rawText: segment,
      action,
      roleNames: stepRoleNames,
      parallelWithPrevious: parallelWithPrevious && steps.length > 0,
      ...(userCheckpoint ? { userCheckpoint: true } : {}),
    });
  }

  if (steps.length === 0) return null;

  return {
    mode: 'dag',
    steps: enrichWorkflowGenerationStepsUserCheckpoint(collapseDuplicatePhaseSteps(steps)),
  };
}

export function extractJsonObject(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** 从模型返回的 who 字段拆出角色名列表。 */
export function roleNamesFromWho(who: string): string[] {
  const trimmed = who.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/[+＋]|[、,，]\s*/u)
    .map((part) => part.replace(/(?:三方|一起|共同|协同|并行)\s*$/u, '').trim())
    .filter((part) => part.length > 0 && part.length <= 24);
}

function parseRollbackToStepNumbers(val: unknown): number[] {
  if (!Array.isArray(val)) return [];
  const out: number[] = [];
  for (const item of val) {
    const n =
      typeof item === 'number'
        ? item
        : typeof item === 'string'
          ? Number.parseInt(item.trim(), 10)
          : Number.NaN;
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

function buildStepDescriptionFromFields(action: string, output?: string | null): string {
  const act = action.trim();
  if (!act) return '';
  const out = output?.trim();
  return out ? `${act}（输出：${out}）` : act;
}

function normalizeWorkflowStepFromAiRecord(
  s: Record<string, unknown>,
): WorkflowGenerationStepDraft | null {
  const who = typeof s.who === 'string' ? s.who.trim() : '';
  const action = typeof s.action === 'string' ? s.action.trim() : '';
  const output =
    typeof s.output === 'string'
      ? s.output.trim() || null
      : s.output === null
        ? null
        : undefined;

  let roleNames: string[] = [];
  if (Array.isArray(s.roleNames)) {
    for (const r of s.roleNames) {
      if (typeof r === 'string' && r.trim()) roleNames.push(r.trim());
    }
  } else if (typeof s.roleName === 'string' && s.roleName.trim()) {
    roleNames.push(s.roleName.trim());
  }
  if (roleNames.length === 0 && who) {
    roleNames = roleNamesFromWho(who);
  }
  if (roleNames.length === 0) return null;

  let title = typeof s.title === 'string' ? s.title.trim() : '';
  if (!title && action) title = summarizeActionTitle(action);
  if (!title) return null;

  const description =
    typeof s.description === 'string' && s.description.trim()
      ? s.description.trim()
      : buildStepDescriptionFromFields(action || title, output ?? null) || undefined;

  return {
    title,
    description,
    rawText: typeof s.rawText === 'string' ? s.rawText : undefined,
    who: who || undefined,
    action: action || undefined,
    output: output ?? undefined,
    roleNames,
    parallelWithPrevious: s.parallelWithPrevious === true,
    rollbackToStepNumbers: parseRollbackToStepNumbers(
      s.rollbackToStepNumbers ?? s.rollbackToSteps,
    ),
    userCheckpoint: s.userCheckpoint === true ? true : undefined,
  };
}

export function resolveStepRollbackTargets(step: WorkflowGenerationStepDraft): number[] {
  if (step.rollbackToStepNumbers && step.rollbackToStepNumbers.length > 0) {
    return step.rollbackToStepNumbers;
  }
  const stepText =
    step.rawText ?? `${step.title}\n${step.description ?? ''}\n${step.action ?? ''}`;
  return inferRollbackStepNumbers(stepText);
}

export function parseWorkflowGenerationDraft(raw: unknown): WorkflowGenerationDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const mode = o.mode === 'dag' || o.mode === 'simple' ? o.mode : 'dag';
  const stepsRaw = o.steps;
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) return null;

  const steps: WorkflowGenerationStepDraft[] = [];
  for (const item of stepsRaw) {
    if (!item || typeof item !== 'object') continue;
    const step = normalizeWorkflowStepFromAiRecord(item as Record<string, unknown>);
    if (step) steps.push(step);
  }

  if (steps.length === 0) return null;
  return {
    mode,
    steps: enrichWorkflowGenerationStepsUserCheckpoint(steps),
  };
}

export function parseWorkflowGenerationFromText(text: string): WorkflowGenerationDraft | null {
  const json = extractJsonObject(text);
  if (json) return parseWorkflowGenerationDraft(json);
  return null;
}

export function resolveStepRoleIds(
  step: WorkflowGenerationStepDraft,
  teamRoles: WorkflowGenMember[],
): string[] {
  const ids: string[] = [];
  for (const name of step.roleNames) {
    const direct = teamRoles.find(
      (r) =>
        r.id === name ||
        r.name === name ||
        r.name.includes(name) ||
        name.includes(r.name) ||
        workflowRoleMatchesToken(r, name),
    );
    if (direct && !ids.includes(direct.id)) ids.push(direct.id);
    else {
      const matched = matchRolesInText(name, teamRoles);
      for (const id of matched) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}

export function assignWorkflowStepLayerIndices(steps: WorkflowGenerationStepDraft[]): number[] {
  const layerIndex: number[] = [];
  let nextSerialLayer = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const stepNum = i + 1;
    const k = step.parallelWithStepNumber;
    if (k != null && k >= 1 && k < stepNum) {
      layerIndex.push(layerIndex[k - 1]!);
    } else if (step.parallelWithPrevious && i > 0) {
      layerIndex.push(layerIndex[i - 1]!);
    } else {
      layerIndex.push(nextSerialLayer);
      nextSerialLayer += 1;
    }
  }
  return layerIndex;
}

export function materializeWorkflowDraft(
  draft: WorkflowGenerationDraft,
  teamRoles: WorkflowGenMember[],
): WorkflowDefinition | null {
  const roster = normalizeWorkflowGenTeam(teamRoles);
  if (draft.steps.length === 0 || roster.length === 0) return null;

  const stepLayerIndex = assignWorkflowStepLayerIndices(draft.steps);
  const layerCount = stepLayerIndex.length > 0 ? Math.max(...stepLayerIndex) + 1 : 0;
  const layers: WorkflowGenerationStepDraft[][] = Array.from({ length: layerCount }, () => []);
  for (let i = 0; i < draft.steps.length; i++) {
    layers[stepLayerIndex[i]!]!.push(draft.steps[i]!);
  }

  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const stepNodeIds: string[] = new Array(draft.steps.length).fill('');
  let nodeIndex = 0;
  let prevLayerNodeIds: string[] = [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx]!;
    const layerNodeIds: string[] = [];
    const layerIsParallelFork = layer.length > 1;
    const parallelGroup = layerIsParallelFork
      ? `pg-${nodes.length}-${layer[0]!.title.trim().slice(0, 16) || 'parallel'}`
      : undefined;

    for (const step of layer) {
      const stepIdx = draft.steps.indexOf(step);
      const roleIds = resolveStepRoleIds(step, roster);
      if (roleIds.length === 0) {
        if (stepIdx >= 0) stepNodeIds[stepIdx] = '';
        continue;
      }

      const nodeId = `gen-${nodeIndex++}`;
      const node = normalizeWorkflowNodeAgents({
        id: nodeId,
        agentId: roleIds[0]!,
        agentIds: roleIds.length > 1 ? roleIds : undefined,
        title: step.title,
        description: step.description ?? step.title,
        execution: 'serial',
        maxRuntimeMinutes: step.maxRuntimeMinutes ?? DEFAULT_NODE_MAX_RUNTIME_MINUTES,
        ...(step.userCheckpoint ? { userCheckpoint: true } : {}),
        parallelGroup: layerIsParallelFork ? parallelGroup : undefined,
      });
      nodes.push(node);
      layerNodeIds.push(nodeId);
      if (stepIdx >= 0) stepNodeIds[stepIdx] = nodeId;

      for (const fromId of prevLayerNodeIds) {
        edges.push({ from: fromId, to: nodeId, when: 'on_success' });
      }
    }

    if (layerNodeIds.length > 0) {
      prevLayerNodeIds = layerNodeIds;
    }
  }

  if (nodes.length === 0) return null;

  for (let stepIdx = 0; stepIdx < draft.steps.length; stepIdx++) {
    const fromNodeId = stepNodeIds[stepIdx] ?? '';
    if (!fromNodeId) continue;
    const step = draft.steps[stepIdx];
    if (!step) continue;
    const rollbackTargets = resolveStepRollbackTargets(step);
    for (const targetNo of rollbackTargets) {
      const toIdx = targetNo - 1;
      if (toIdx < 0 || toIdx >= stepNodeIds.length) continue;
      const toNodeId = stepNodeIds[toIdx] ?? '';
      if (!toNodeId || toNodeId === fromNodeId) continue;
      const exists = edges.some(
        (e) => e.from === fromNodeId && e.to === toNodeId && (e.when ?? 'on_success') === 'on_failure',
      );
      if (!exists) edges.push({ from: fromNodeId, to: toNodeId, when: 'on_failure' });
    }
  }

  const useDag = draft.mode !== 'simple' || edges.length > 0;
  let workflow: WorkflowDefinition = {
    mode: useDag ? 'dag' : 'simple',
    nodes,
    edges: useDag ? edges : [],
    edgesCustomized: useDag && edges.length > 0,
  };

  if (!workflow.edgesCustomized) {
    workflow = syncWorkflowEdges(workflow);
  }

  const validation = validateWorkflowEdges(workflow);
  if (!validation.valid && workflow.nodes.length > 1) {
    workflow = syncWorkflowEdges({
      mode: 'dag',
      nodes: workflow.nodes,
      edges: [],
      edgesCustomized: false,
    });
  }

  return workflow;
}

function langGraphExecId(officeNodeId: string): string {
  return `lgn-exec-${officeNodeId}`;
}

function langGraphFanOutId(layerIndex: number): string {
  return `lgn-fan-out-${layerIndex}`;
}

function langGraphFanInId(layerIndex: number): string {
  return `lgn-fan-in-${layerIndex}`;
}

function langGraphCheckpointId(layerIndex: number): string {
  return `lgn-cp-${layerIndex}`;
}

function langGraphSubgraphId(layerIndex: number): string {
  return `lgn-sub-${layerIndex}`;
}

export function materializeLangGraphWorkflowDraft(
  draft: WorkflowGenerationDraft,
  teamRoles: WorkflowGenMember[],
): WorkflowDefinition | null {
  const roster = normalizeWorkflowGenTeam(teamRoles);
  if (draft.steps.length === 0 || roster.length === 0) return null;

  const workflowNodes: WorkflowNode[] = [];
  const stepNodeIds: string[] = new Array(draft.steps.length).fill('');
  const planNodes: LangGraphPlanNode[] = [];
  const planEdges: LangGraphPlanEdge[] = [];
  const conditionalRoutes: LangGraphConditionalRoute[] = [];
  const subgraphs: LangGraphSubgraph[] = [];
  const visualLayers: LangGraphVisualLayer[] = [];

  const stepLayers: Array<Array<{ step: WorkflowGenerationStepDraft; stepIndex: number }>> = [];
  for (let stepIndex = 0; stepIndex < draft.steps.length; stepIndex++) {
    const step = draft.steps[stepIndex]!;
    if (step.parallelWithPrevious && stepLayers.length > 0) {
      stepLayers[stepLayers.length - 1]!.push({ step, stepIndex });
    } else {
      stepLayers.push([{ step, stepIndex }]);
    }
  }

  let nodeIndex = 0;
  let entry = '';

  for (let layerIndex = 0; layerIndex < stepLayers.length; layerIndex++) {
    const layer = stepLayers[layerIndex]!;
    const execGraphIds: string[] = [];
    const parallelGroup =
      layer.length > 1
        ? `lg-parallel-${layerIndex}-${layer[0]!.step.title.trim().slice(0, 16) || 'parallel'}`
        : undefined;

    for (const { step, stepIndex } of layer) {
      const roleIds = resolveStepRoleIds(step, roster);
      if (roleIds.length === 0) {
        stepNodeIds[stepIndex] = '';
        continue;
      }

      const officeNodeId = `lg-${nodeIndex++}`;
      const officeNode = normalizeWorkflowNodeAgents({
        id: officeNodeId,
        agentId: roleIds[0]!,
        agentIds: roleIds.length > 1 ? roleIds : undefined,
        title: step.title,
        description: step.description ?? step.title,
        execution: 'serial',
        maxRuntimeMinutes: step.maxRuntimeMinutes ?? DEFAULT_NODE_MAX_RUNTIME_MINUTES,
        ...(step.userCheckpoint ? { userCheckpoint: true } : {}),
        parallelGroup,
      });
      workflowNodes.push(officeNode);
      stepNodeIds[stepIndex] = officeNodeId;

      const graphId = langGraphExecId(officeNodeId);
      execGraphIds.push(graphId);
      planNodes.push({
        id: graphId,
        kind: 'execute',
        label: officeNode.title ?? officeNodeId,
        officeNodeId,
        parallelGroup,
        subgraphId: layer.length > 1 ? langGraphSubgraphId(layerIndex) : undefined,
      });
    }

    if (execGraphIds.length === 0) continue;

    let layerEntry: string;
    let layerExit: string;

    if (execGraphIds.length > 1) {
      const outId = langGraphFanOutId(layerIndex);
      const inId = langGraphFanInId(layerIndex);
      const subId = langGraphSubgraphId(layerIndex);
      const subLabel = parallelGroup ?? `Parallel ${layerIndex + 1}`;

      planNodes.push({
        id: outId,
        kind: 'fan_out',
        label: subLabel,
        subgraphId: subId,
        parallelGroup,
      });
      planNodes.push({
        id: inId,
        kind: 'fan_in',
        label: subLabel,
        subgraphId: subId,
        parallelGroup,
      });

      for (const target of execGraphIds) {
        planEdges.push({ from: outId, to: target, when: 'always' });
        planEdges.push({ from: target, to: inId, when: 'on_success' });
      }

      subgraphs.push({
        id: subId,
        label: subLabel,
        entry: outId,
        exit: inId,
        nodeIds: [outId, ...execGraphIds, inId],
      });

      layerEntry = outId;
      layerExit = inId;
      visualLayers.push({
        kind: 'parallel',
        nodeIds: [outId, ...execGraphIds, inId],
        subgraphId: subId,
      });
    } else {
      layerEntry = execGraphIds[0]!;
      layerExit = execGraphIds[0]!;
      visualLayers.push({ kind: 'sequential', nodeIds: [...execGraphIds] });
    }

    const cpId = langGraphCheckpointId(layerIndex);
    planNodes.push({
      id: cpId,
      kind: 'checkpoint',
      label: `Checkpoint ${layerIndex + 1}`,
    });
    planEdges.push({ from: layerExit, to: cpId, when: 'always' });
    visualLayers[visualLayers.length - 1]!.nodeIds.push(cpId);

    if (layerIndex === 0) {
      entry = layerEntry;
    } else {
      planEdges.push({
        from: langGraphCheckpointId(layerIndex - 1),
        to: layerEntry,
        when: 'always',
      });
    }
  }

  if (!entry || workflowNodes.length === 0) return null;

  for (let stepIdx = 0; stepIdx < draft.steps.length; stepIdx++) {
    const fromOfficeId = stepNodeIds[stepIdx] ?? '';
    if (!fromOfficeId) continue;
    const step = draft.steps[stepIdx]!;
    const rollbackTargets = resolveStepRollbackTargets(step);
    if (rollbackTargets.length === 0) continue;

    const fromGraphId = langGraphExecId(fromOfficeId);
    const cpTarget = planEdges.find((edge) => edge.from === fromGraphId && edge.when === 'always')?.to;
    const failureTargets = rollbackTargets
      .map((n) => stepNodeIds[n - 1] ?? '')
      .filter(Boolean)
      .map((id) => langGraphExecId(id));

    if (failureTargets.length === 0) continue;

    conditionalRoutes.push({
      from: fromGraphId,
      branches: [
        { key: 'success', when: 'success', targets: cpTarget ? [cpTarget] : [] },
        { key: 'failure', when: 'failure', targets: failureTargets },
      ],
    });
  }

  const rollbackEdges: WorkflowEdge[] = conditionalRoutes.flatMap((route) => {
    const officeFrom = planNodes.find((node) => node.id === route.from)?.officeNodeId;
    if (!officeFrom) return [];
    const failureBranch = route.branches.find((branch) => branch.when === 'failure');
    return (failureBranch?.targets ?? [])
      .map((target) => planNodes.find((node) => node.id === target)?.officeNodeId)
      .filter((to): to is string => !!to && to !== officeFrom)
      .map((to) => ({ from: officeFrom, to, when: 'on_failure' as const }));
  });

  const orchestrationPlan: LangGraphOrchestrationPlan = {
    kind: 'langgraph_native',
    version: 3,
    nativeRuntime: 'subgraph_store',
    checkpointer: 'office_store',
    entry,
    nodes: planNodes,
    edges: planEdges,
    conditionalRoutes,
    subgraphs,
    visualLayers,
  };

  return {
    mode: 'dag',
    nodes: workflowNodes,
    edges: rollbackEdges,
    edgesCustomized: true,
    orchestrationEngine: 'langgraph',
    orchestrationPlan,
  };
}

export function generateWorkflowFromDescriptionHeuristic(
  description: string,
  teamRoles: WorkflowGenMember[],
): WorkflowGenerateResult | null {
  const draft = buildHeuristicWorkflowDraft(description, teamRoles);
  if (!draft) return null;
  const workflow = materializeWorkflowDraft(draft, teamRoles);
  if (!workflow) return null;

  return {
    workflow,
    mode: workflow.mode,
    source: 'heuristic',
    summary: summarizeWorkflow(workflow, teamRoles),
  };
}

export function generateLangGraphWorkflowFromDescriptionHeuristic(
  description: string,
  teamRoles: WorkflowGenMember[],
): WorkflowGenerateResult | null {
  const draft = buildHeuristicWorkflowDraft(description, teamRoles);
  if (!draft) return null;
  const workflow = materializeLangGraphWorkflowDraft(draft, teamRoles);
  if (!workflow) return null;

  return {
    workflow,
    mode: workflow.mode,
    source: 'langgraph_heuristic',
    summary: summarizeWorkflow(workflow, teamRoles),
  };
}

export function generateWorkflowFromDraft(
  draft: WorkflowGenerationDraft,
  teamRoles: WorkflowGenMember[],
  source: WorkflowGenerateSource,
  options?: { orchestrationEngine?: 'dag' | 'langgraph' },
): WorkflowGenerateResult | null {
  const workflow =
    options?.orchestrationEngine === 'langgraph'
      ? materializeLangGraphWorkflowDraft(draft, teamRoles)
      : materializeWorkflowDraft(draft, teamRoles);
  if (!workflow) return null;
  return {
    workflow,
    mode: workflow.mode,
    source,
    summary: summarizeWorkflow(workflow, teamRoles),
  };
}

/** Baseline for “regenerate workflow” stale UI — only workflow description text. */
export function workflowDescriptionGenerationKey(description: string): string {
  return description.trim();
}

export function summarizeWorkflow(
  workflow: WorkflowDefinition,
  teamRoles: WorkflowGenMember[],
): string {
  return workflow.nodes
    .map((n, i) => {
      const ids = n.agentIds?.length ? n.agentIds : [n.agentId];
      const names = ids
        .map((id) => teamRoles.find((r) => r.id === id)?.name ?? id)
        .join('+');
      return `${i + 1}. ${n.title?.trim() || '步骤'}（${names}）`;
    })
    .join(' → ');
}
