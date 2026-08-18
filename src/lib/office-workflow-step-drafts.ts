import {
  buildHeuristicWorkflowDraft,
  generateWorkflowFromDraft,
  summarizeActionTitle,
  workflowGenMembersFromRefs,
  type WorkflowGenerationDraft,
  type WorkflowGenerationStepDraft,
  type WorkflowGenerateResult,
} from '@/lib/office-workflow-generate';
import { stripUnknownWorkflowStepDraftAgentIds } from '@/lib/office-agent-id-remap';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { DEFAULT_NODE_MAX_RUNTIME_MINUTES } from '@/lib/office-workflow-roles';
import { clampMaxRuntimeMinutes } from '@/lib/office-workflow-max-runtime-step';
import type { OfficeWorkflowEngine, WorkflowStepDraftRow, WorkflowStepLinkMode } from '@/types/office';

export const DEFAULT_WORKFLOW_STEP_DRAFT_ROW_COUNT = 3;

export type WorkflowStepDraftsValidationError =
  | 'partial_row'
  | 'gap_row'
  | 'invalid_row'
  | 'min_valid_rows'
  | 'parallel_step_required'
  | 'parallel_step_invalid'
  | 'rollback_condition_required'
  | 'rollback_step_required'
  | 'rollback_step_invalid';

export interface WorkflowStepDraftsValidationResult {
  ok: boolean;
  error?: WorkflowStepDraftsValidationError;
  errorStep?: number;
  validCount: number;
}

export function emptyWorkflowStepDraftRow(): WorkflowStepDraftRow {
  return {
    input: '',
    agentIds: [],
    task: '',
    output: '',
    linkMode: 'serial',
    rollbackEnabled: false,
    rollbackCondition: '',
    maxRuntimeMinutes: DEFAULT_NODE_MAX_RUNTIME_MINUTES,
    userCheckpoint: false,
  };
}

export function stepDraftUserCheckpoint(
  row: Pick<WorkflowStepDraftRow, 'userCheckpoint'>,
): boolean {
  return row.userCheckpoint === true;
}

export function stepDraftMaxRuntimeMinutes(
  row: Pick<WorkflowStepDraftRow, 'maxRuntimeMinutes'>,
): number {
  const v = row.maxRuntimeMinutes;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return clampMaxRuntimeMinutes(v);
  }
  return DEFAULT_NODE_MAX_RUNTIME_MINUTES;
}

export function emptyWorkflowStepDraftRows(
  count = DEFAULT_WORKFLOW_STEP_DRAFT_ROW_COUNT,
): WorkflowStepDraftRow[] {
  return Array.from({ length: count }, () => emptyWorkflowStepDraftRow());
}

export function isWorkflowStepDraftRowEmpty(row: WorkflowStepDraftRow): boolean {
  return (
    !row.input.trim()
    && row.agentIds.length === 0
    && !row.task.trim()
    && !row.output.trim()
    && row.linkMode === 'serial'
    && row.parallelWithStep == null
    && !row.rollbackEnabled
    && !(row.rollbackCondition?.trim())
    && row.rollbackStep == null
  );
}

function rowRollbackEnabled(row: WorkflowStepDraftRow): boolean {
  return row.rollbackEnabled === true;
}

/** 回滚目标步骤可选 1～N-1。 */
export function rollbackStepOptions(stepNumber: number): number[] {
  if (stepNumber <= 1) return [];
  return Array.from({ length: stepNumber - 1 }, (_, i) => i + 1);
}

export function isRollbackStepAllowed(stepNumber: number, rollbackStep: number): boolean {
  return rollbackStepOptions(stepNumber).includes(rollbackStep);
}

export function isWorkflowStepDraftRowPartial(row: WorkflowStepDraftRow): boolean {
  if (isWorkflowStepDraftRowEmpty(row)) return false;
  const hasTask = !!row.task.trim();
  const hasWho = row.agentIds.length > 0;
  const hasLink =
    row.linkMode === 'serial'
    || (row.linkMode === 'parallel' && row.parallelWithStep != null);
  const hasRollback =
    !rowRollbackEnabled(row)
    || (
      !!row.rollbackCondition?.trim()
      && row.rollbackStep != null
    );
  return !(hasTask && hasWho && hasLink && hasRollback);
}

/** 第 stepNumber 步之前，最后一个串行步骤编号；若不存在则返回 null。 */
export function lastSerialStepBefore(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
): number | null {
  if (stepNumber <= 1) return null;
  for (let k = stepNumber - 1; k >= 1; k -= 1) {
    if (rows[k - 1]?.linkMode === 'serial') return k;
  }
  return null;
}

/** 第 1～stepNumber-1 步是否全部为并行。 */
export function allPriorStepsParallel(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
): boolean {
  if (stepNumber <= 1) return false;
  for (let k = 1; k < stepNumber; k += 1) {
    if (rows[k - 1]?.linkMode === 'serial') return false;
  }
  return true;
}

/**
 * 并行步骤可选编号：
 * - 有串行锚点 X：X～N-1
 * - 否则 fallback：1～N-1（语义上均与第 1 步并行）
 */
export function parallelStepOptions(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
): number[] {
  if (stepNumber <= 1) return [];
  const lastSerial = lastSerialStepBefore(rows, stepNumber);
  if (lastSerial == null) {
    return Array.from({ length: stepNumber - 1 }, (_, i) => i + 1);
  }
  const start = lastSerial;
  const end = stepNumber - 1;
  if (start > end) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function isParallelWithStepAllowed(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
  parallelWithStep: number,
): boolean {
  return parallelStepOptions(rows, stepNumber).includes(parallelWithStep);
}

/** 生成 DAG 时：若前面全并行，统一归并为与第 1 步并行。 */
export function effectiveParallelWithStep(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
  parallelWithStep: number | undefined,
): number | undefined {
  if (parallelWithStep == null) return undefined;
  if (allPriorStepsParallel(rows, stepNumber)) return 1;
  return parallelWithStep;
}

/** 上一步交付物摘要，供「默认上游交付物」展示。 */
export function upstreamDeliverableSummary(
  rows: WorkflowStepDraftRow[],
  stepNumber: number,
): string | null {
  if (stepNumber <= 1) return null;
  const prev = rows[stepNumber - 2];
  if (!prev) return null;
  const output = prev.output.trim();
  if (output) return output;
  const task = prev.task.trim();
  if (task) return task;
  return null;
}

export function normalizeWorkflowStepDraftParallelSteps(
  rows: WorkflowStepDraftRow[],
): WorkflowStepDraftRow[] {
  const next = rows.map((row) => ({ ...row, agentIds: [...row.agentIds] }));
  for (let i = 0; i < next.length; i += 1) {
    const stepNumber = i + 1;
    const row = next[i]!;
    // 首节点无可并行对象，始终串行。
    if (stepNumber <= 1) {
      if (row.linkMode !== 'serial' || row.parallelWithStep != null) {
        next[i] = { ...row, linkMode: 'serial', parallelWithStep: undefined };
      }
      continue;
    }
    if (row.linkMode !== 'parallel') {
      if (row.parallelWithStep != null) {
        next[i] = { ...row, parallelWithStep: undefined };
      }
      continue;
    }
    const options = parallelStepOptions(next, stepNumber);
    if (options.length === 0) {
      next[i] = { ...row, linkMode: 'serial', parallelWithStep: undefined };
      continue;
    }
    if (row.parallelWithStep == null || !options.includes(row.parallelWithStep)) {
      next[i] = { ...row, parallelWithStep: options[options.length - 1] };
    }
  }
  return next;
}

export function normalizeWorkflowStepDraftRollbackSteps(
  rows: WorkflowStepDraftRow[],
): WorkflowStepDraftRow[] {
  const next = rows.map((row) => ({ ...row, agentIds: [...row.agentIds] }));
  for (let i = 0; i < next.length; i += 1) {
    const stepNumber = i + 1;
    const row = next[i]!;
    if (!rowRollbackEnabled(row) || stepNumber <= 1) {
      next[i] = {
        ...row,
        rollbackEnabled: false,
        rollbackCondition: '',
        rollbackStep: undefined,
      };
      continue;
    }
    const options = rollbackStepOptions(stepNumber);
    const condition = row.rollbackCondition?.trim() ?? '';
    let rollbackStep = row.rollbackStep;
    if (rollbackStep == null || !options.includes(rollbackStep)) {
      rollbackStep = options[options.length - 1];
    }
    next[i] = {
      ...row,
      rollbackEnabled: true,
      rollbackCondition: condition,
      rollbackStep,
    };
  }
  return next;
}

export function normalizeWorkflowStepDraftRows(
  rows: WorkflowStepDraftRow[],
): WorkflowStepDraftRow[] {
  return normalizeWorkflowStepDraftRollbackSteps(normalizeWorkflowStepDraftParallelSteps(rows));
}

/** 删除指定节点并重排后续节点的并行/回滚步骤编号（减 1）。 */
export function removeWorkflowStepDraftRow(
  rows: WorkflowStepDraftRow[],
  index: number,
): WorkflowStepDraftRow[] {
  if (rows.length <= 1) return rows;
  if (index < 0 || index >= rows.length) return rows;

  const deletedStep = index + 1;
  const remaining = rows.filter((_, i) => i !== index);

  const adjusted = remaining.map((row) => {
    let parallelWithStep = row.parallelWithStep;
    if (parallelWithStep != null) {
      if (parallelWithStep === deletedStep) {
        parallelWithStep = deletedStep > 1 ? deletedStep - 1 : undefined;
      } else if (parallelWithStep > deletedStep) {
        parallelWithStep -= 1;
      }
    }

    let rollbackStep = row.rollbackStep;
    if (rollbackStep != null) {
      if (rollbackStep === deletedStep) {
        rollbackStep = deletedStep > 1 ? deletedStep - 1 : undefined;
      } else if (rollbackStep > deletedStep) {
        rollbackStep -= 1;
      }
    }

    return {
      ...row,
      agentIds: [...row.agentIds],
      parallelWithStep,
      rollbackStep,
    };
  });

  return normalizeWorkflowStepDraftRows(adjusted);
}

export function isWorkflowStepDraftRowValid(
  row: WorkflowStepDraftRow,
  options: { stepNumber: number; memberAgentIds: string[]; rows: WorkflowStepDraftRow[] },
): boolean {
  const { stepNumber, memberAgentIds, rows } = options;
  const memberSet = new Set(memberAgentIds);
  if (!row.task.trim()) return false;
  if (row.agentIds.length === 0) return false;
  if (!row.agentIds.every((id) => memberSet.has(id))) return false;
  if (row.linkMode !== 'serial' && row.linkMode !== 'parallel') return false;
  if (row.linkMode === 'parallel') {
    const k = row.parallelWithStep;
    if (k == null || !Number.isInteger(k) || k < 1) return false;
    if (!isParallelWithStepAllowed(rows, stepNumber, k)) return false;
  }
  if (rowRollbackEnabled(row)) {
    if (stepNumber <= 1) return false;
    if (!row.rollbackCondition?.trim()) return false;
    const rb = row.rollbackStep;
    if (rb == null || !isRollbackStepAllowed(stepNumber, rb)) return false;
  }
  return true;
}

function findLastNonEmptyRowIndex(rows: WorkflowStepDraftRow[]): number {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!isWorkflowStepDraftRowEmpty(rows[i]!)) return i;
  }
  return -1;
}

export function validateWorkflowStepDraftRows(
  rows: WorkflowStepDraftRow[],
  memberAgentIds: string[],
  options?: { minValidRows?: number },
): WorkflowStepDraftsValidationResult {
  const minValidRows = options?.minValidRows ?? 0;
  const lastNonEmpty = findLastNonEmptyRowIndex(rows);
  if (lastNonEmpty < 0) {
    if (minValidRows > 0) {
      return { ok: false, error: 'min_valid_rows', validCount: 0 };
    }
    return { ok: true, validCount: 0 };
  }

  for (let i = 0; i <= lastNonEmpty; i++) {
    const stepNumber = i + 1;
    const row = rows[i]!;
    if (isWorkflowStepDraftRowEmpty(row)) {
      return { ok: false, error: 'gap_row', errorStep: stepNumber, validCount: 0 };
    }
    if (row.linkMode === 'parallel' && row.parallelWithStep == null) {
      return { ok: false, error: 'parallel_step_required', errorStep: stepNumber, validCount: 0 };
    }
    if (rowRollbackEnabled(row)) {
      if (!row.rollbackCondition?.trim()) {
        return { ok: false, error: 'rollback_condition_required', errorStep: stepNumber, validCount: 0 };
      }
      if (row.rollbackStep == null) {
        return { ok: false, error: 'rollback_step_required', errorStep: stepNumber, validCount: 0 };
      }
      if (!isRollbackStepAllowed(stepNumber, row.rollbackStep)) {
        return { ok: false, error: 'rollback_step_invalid', errorStep: stepNumber, validCount: 0 };
      }
    }
    if (isWorkflowStepDraftRowPartial(row)) {
      return { ok: false, error: 'partial_row', errorStep: stepNumber, validCount: 0 };
    }
    if (!isWorkflowStepDraftRowValid(row, { stepNumber, memberAgentIds, rows })) {
      if (row.linkMode === 'parallel' && row.parallelWithStep == null) {
        return { ok: false, error: 'parallel_step_required', errorStep: stepNumber, validCount: 0 };
      }
      if (
        row.linkMode === 'parallel'
        && row.parallelWithStep != null
        && !isParallelWithStepAllowed(rows, stepNumber, row.parallelWithStep)
      ) {
        return { ok: false, error: 'parallel_step_invalid', errorStep: stepNumber, validCount: 0 };
      }
      if (rowRollbackEnabled(row) && !row.rollbackCondition?.trim()) {
        return { ok: false, error: 'rollback_condition_required', errorStep: stepNumber, validCount: 0 };
      }
      if (rowRollbackEnabled(row) && row.rollbackStep == null) {
        return { ok: false, error: 'rollback_step_required', errorStep: stepNumber, validCount: 0 };
      }
      if (
        rowRollbackEnabled(row)
        && row.rollbackStep != null
        && !isRollbackStepAllowed(stepNumber, row.rollbackStep)
      ) {
        return { ok: false, error: 'rollback_step_invalid', errorStep: stepNumber, validCount: 0 };
      }
      return { ok: false, error: 'invalid_row', errorStep: stepNumber, validCount: 0 };
    }
  }

  const validCount = lastNonEmpty + 1;
  if (validCount < minValidRows) {
    return { ok: false, error: 'min_valid_rows', validCount };
  }
  return { ok: true, validCount };
}

export function trimWorkflowStepDraftRows(rows: WorkflowStepDraftRow[]): WorkflowStepDraftRow[] {
  const lastNonEmpty = findLastNonEmptyRowIndex(rows);
  if (lastNonEmpty < 0) return [];
  return rows.slice(0, lastNonEmpty + 1).map((row) => ({ ...row, agentIds: [...row.agentIds] }));
}

function memberNameMap(members: ProjectAgentRef[]): Map<string, string> {
  return new Map(members.map((m) => [m.agentId, m.displayName]));
}

function roleNamesForRow(row: WorkflowStepDraftRow, nameById: Map<string, string>): string[] {
  return row.agentIds.map((id) => nameById.get(id) ?? id);
}

function buildRowDescription(row: WorkflowStepDraftRow): string {
  const parts: string[] = [];
  if (row.input.trim()) {
    parts.push(`输入：${row.input.trim()}`);
  }
  parts.push(row.task.trim());
  if (row.output.trim()) {
    parts.push(`输出：${row.output.trim()}`);
  }
  return parts.join('；');
}

function buildRowRawText(
  row: WorkflowStepDraftRow,
  stepNumber: number,
  nameById: Map<string, string>,
  rows: WorkflowStepDraftRow[],
): string {
  const who = roleNamesForRow(row, nameById).join('+');
  const chunks = [
    `任务${stepNumber}`,
    who ? `${who}负责` : '',
    row.task.trim(),
  ].filter(Boolean);
  if (row.input.trim()) chunks.push(`输入：${row.input.trim()}`);
  if (row.output.trim()) chunks.push(`输出：${row.output.trim()}`);
  const effectiveParallel = effectiveParallelWithStep(rows, stepNumber, row.parallelWithStep);
  if (row.linkMode === 'parallel' && effectiveParallel != null) {
    chunks.push(`与第${effectiveParallel}步并行`);
  }
  if (rowRollbackEnabled(row) && row.rollbackStep != null && row.rollbackCondition?.trim()) {
    chunks.push(`回滚至第${row.rollbackStep}步（${row.rollbackCondition.trim()}）`);
  }
  return chunks.join('，');
}

export function workflowStepDraftRowToGenerationStep(
  row: WorkflowStepDraftRow,
  stepNumber: number,
  members: ProjectAgentRef[],
  rows: WorkflowStepDraftRow[],
): WorkflowGenerationStepDraft {
  const nameById = memberNameMap(members);
  const roleNames = roleNamesForRow(row, nameById);
  const parallelWithStep =
    row.linkMode === 'parallel'
      ? effectiveParallelWithStep(rows, stepNumber, row.parallelWithStep)
      : undefined;
  const rollbackToStepNumbers =
    rowRollbackEnabled(row) && row.rollbackStep != null && row.rollbackStep > 0
      ? [row.rollbackStep]
      : undefined;
  return {
    title: summarizeActionTitle(row.task.trim()),
    description: buildRowDescription(row),
    rawText: buildRowRawText(row, stepNumber, nameById, rows),
    who: roleNames.join('+'),
    action: row.task.trim(),
    output: row.output.trim() || null,
    roleNames,
    parallelWithPrevious: parallelWithStep === stepNumber - 1,
    parallelWithStepNumber:
      parallelWithStep != null && parallelWithStep < stepNumber - 1
        ? parallelWithStep
        : undefined,
    maxRuntimeMinutes: stepDraftMaxRuntimeMinutes(row),
    ...(stepDraftUserCheckpoint(row) ? { userCheckpoint: true } : {}),
    rollbackToStepNumbers,
  };
}

export function workflowStepDraftsToGenerationDraft(
  rows: WorkflowStepDraftRow[],
  members: ProjectAgentRef[],
): WorkflowGenerationDraft | null {
  const memberIds = members.map((m) => m.agentId);
  const sanitized = stripUnknownWorkflowStepDraftAgentIds(
    trimWorkflowStepDraftRows(rows),
    memberIds,
  );
  const trimmed = trimWorkflowStepDraftRows(sanitized);
  if (trimmed.length === 0) return null;
  const validation = validateWorkflowStepDraftRows(trimmed, memberIds, { minValidRows: 1 });
  if (!validation.ok) return null;
  return {
    mode: 'dag',
    steps: trimmed.map((row, index) =>
      workflowStepDraftRowToGenerationStep(row, index + 1, members, trimmed),
    ),
  };
}

export function workflowStepDraftsToDescription(
  rows: WorkflowStepDraftRow[],
  members: ProjectAgentRef[],
): string {
  const trimmed = trimWorkflowStepDraftRows(rows);
  if (trimmed.length === 0) return '';
  const nameById = memberNameMap(members);
  return trimmed
    .map((row, index) => buildRowRawText(row, index + 1, nameById, trimmed))
    .join('\n');
}

export function workflowStepDraftsGenerationKey(rows: WorkflowStepDraftRow[]): string {
  const trimmed = trimWorkflowStepDraftRows(rows);
  return JSON.stringify(
    trimmed.map((row) => ({
      input: row.input.trim(),
      agentIds: [...row.agentIds].sort(),
      task: row.task.trim(),
      output: row.output.trim(),
      linkMode: row.linkMode,
      parallelWithStep: row.linkMode === 'parallel' ? row.parallelWithStep ?? null : null,
      rollbackEnabled: rowRollbackEnabled(row),
      rollbackCondition: rowRollbackEnabled(row) ? row.rollbackCondition?.trim() ?? '' : '',
      rollbackStep: rowRollbackEnabled(row) ? row.rollbackStep ?? null : null,
      maxRuntimeMinutes: stepDraftMaxRuntimeMinutes(row),
      userCheckpoint: stepDraftUserCheckpoint(row),
    })),
  );
}

export function workflowStepDraftsFromDescription(
  description: string,
  members: ProjectAgentRef[],
): WorkflowStepDraftRow[] {
  const draft = buildHeuristicWorkflowDraft(description, workflowGenMembersFromRefs(members));
  if (!draft || draft.steps.length === 0) {
    return emptyWorkflowStepDraftRows();
  }
  const idByName = new Map(members.map((m) => [m.displayName, m.agentId]));
  const rows: WorkflowStepDraftRow[] = draft.steps.map((step, index) => {
    const stepNum = index + 1;
    const agentIds = step.roleNames
      .map((name) => idByName.get(name) ?? members.find((m) => m.agentId === name)?.agentId)
      .filter((id): id is string => !!id);
    const linkMode: WorkflowStepLinkMode =
      step.parallelWithPrevious || step.parallelWithStepNumber ? 'parallel' : 'serial';
    const parallelWithStep =
      linkMode === 'parallel'
        ? step.parallelWithStepNumber ?? (stepNum > 1 ? stepNum - 1 : undefined)
        : undefined;
    return {
      input: '',
      agentIds: agentIds.length > 0 ? agentIds : [],
      task: step.action?.trim() || step.title?.trim() || step.description?.trim() || '',
      output: typeof step.output === 'string' ? step.output : '',
      linkMode,
      parallelWithStep,
      ...(step.userCheckpoint === true ? { userCheckpoint: true } : {}),
    };
  });
  while (rows.length < DEFAULT_WORKFLOW_STEP_DRAFT_ROW_COUNT) {
    rows.push(emptyWorkflowStepDraftRow());
  }
  return rows;
}

export function hasWorkflowStepDraftContent(rows?: WorkflowStepDraftRow[]): boolean {
  return trimWorkflowStepDraftRows(rows ?? []).length > 0;
}

export function resolveWorkflowStepDraftRows(
  stored: WorkflowStepDraftRow[] | undefined,
  workflowDescription: string | undefined,
  members: ProjectAgentRef[],
): WorkflowStepDraftRow[] {
  if (hasWorkflowStepDraftContent(stored)) {
    const trimmed = trimWorkflowStepDraftRows(stored ?? []);
    const padded: WorkflowStepDraftRow[] = trimmed.map((row) => ({
      ...emptyWorkflowStepDraftRow(),
      ...row,
      agentIds: [...(row.agentIds ?? [])],
      rollbackEnabled: row.rollbackEnabled ?? false,
      rollbackCondition: row.rollbackCondition ?? '',
      userCheckpoint: row.userCheckpoint ?? false,
    }));
    while (padded.length < DEFAULT_WORKFLOW_STEP_DRAFT_ROW_COUNT) {
      padded.push(emptyWorkflowStepDraftRow());
    }
    return padded;
  }
  const desc = workflowDescription?.trim() ?? '';
  if (desc) return workflowStepDraftsFromDescription(desc, members);
  return emptyWorkflowStepDraftRows();
}

export function generateWorkflowFromStepDraftRows(
  rows: WorkflowStepDraftRow[],
  members: ProjectAgentRef[],
  workflowEngine?: OfficeWorkflowEngine,
): WorkflowGenerateResult | null {
  const draft = workflowStepDraftsToGenerationDraft(rows, members);
  if (!draft) return null;
  const source = workflowEngine === 'langgraph' ? 'langgraph_heuristic' : 'heuristic';
  return generateWorkflowFromDraft(draft, workflowGenMembersFromRefs(members), source, {
    orchestrationEngine: workflowEngine === 'langgraph' ? 'langgraph' : 'dag',
  });
}

export function prepareWorkflowStepDraftsPayload(
  rows: WorkflowStepDraftRow[],
  members: ProjectAgentRef[],
): { workflowStepDrafts: WorkflowStepDraftRow[]; workflowDescription: string } {
  const workflowStepDrafts = trimWorkflowStepDraftRows(rows);
  return {
    workflowStepDrafts,
    workflowDescription: workflowStepDraftsToDescription(workflowStepDrafts, members),
  };
}

export function workflowDescriptionOrDraftsKey(
  workflowDescription: string,
  workflowStepDrafts?: WorkflowStepDraftRow[],
): string {
  if (hasWorkflowStepDraftContent(workflowStepDrafts)) {
    return `drafts:${workflowStepDraftsGenerationKey(workflowStepDrafts ?? [])}`;
  }
  return workflowDescription.trim();
}
