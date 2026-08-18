import { validateWorkflowRoomJsonForRunner } from '@/lib/office-workflow-room-json-validate';
import { parseWorkflowJsonObjectDetailed } from '@/lib/office-workflow-json-parse';

export type WorkflowJsonOutput = {
  role: string;
  step: { index: number; total: number; title: string };
  inputValidation: { targets: string[]; lsResult: string[] };
  execution: string;
  outputValidation: { targets: string[]; lsResult: string[] };
  deliverable: {
    path: string;
    summary: string;
    conclusion: '通过' | '不通过' | '已交付';
  };
  rollback: string;
};

function parseWorkflowStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (!value.every((v) => typeof v === 'string')) return null;
  return value;
}

export type WorkflowJsonOutputParseResult =
  | {
      ok: true;
      json: WorkflowJsonOutput;
      raw: string;
      repaired: boolean;
    }
  | {
      ok: false;
      stage: 'syntax' | 'fields' | 'values';
      issues: Array<'invalid_json_syntax' | 'invalid_json_missing_fields' | 'invalid_json_value'>;
      detail: string;
      raw: string;
    };

const WORKFLOW_REQUIRED_FIELDS = [
  'role',
  'step',
  'inputValidation',
  'execution',
  'outputValidation',
  'deliverable',
  'rollback',
] as const;

function missingWorkflowFields(obj: Record<string, unknown>): string[] {
  const missing: string[] = [];
  for (const key of WORKFLOW_REQUIRED_FIELDS) {
    if (!(key in obj)) missing.push(key);
  }
  const step = obj.step && typeof obj.step === 'object' ? (obj.step as Record<string, unknown>) : null;
  for (const key of ['index', 'total', 'title'] as const) {
    if (!step || !(key in step)) missing.push(`step.${key}`);
  }
  const input = obj.inputValidation && typeof obj.inputValidation === 'object'
    ? (obj.inputValidation as Record<string, unknown>)
    : null;
  for (const key of ['targets', 'lsResult'] as const) {
    if (!input || !(key in input)) missing.push(`inputValidation.${key}`);
  }
  const output = obj.outputValidation && typeof obj.outputValidation === 'object'
    ? (obj.outputValidation as Record<string, unknown>)
    : null;
  for (const key of ['targets', 'lsResult'] as const) {
    if (!output || !(key in output)) missing.push(`outputValidation.${key}`);
  }
  const deliver = obj.deliverable && typeof obj.deliverable === 'object'
    ? (obj.deliverable as Record<string, unknown>)
    : null;
  for (const key of ['path', 'summary', 'conclusion'] as const) {
    if (!deliver || !(key in deliver)) missing.push(`deliverable.${key}`);
  }
  return missing;
}

/** 从群聊/Session 正文中分层解析 Workflow 节点 JSON。 */
export function parseWorkflowJsonOutputDetailed(raw: string): WorkflowJsonOutputParseResult {
  const parsedObject = parseWorkflowJsonObjectDetailed(raw);
  if (!parsedObject.ok) {
    return {
      ok: false,
      stage: 'syntax',
      issues: ['invalid_json_syntax'],
      detail: parsedObject.detail,
      raw,
    };
  }

  const obj = parsedObject.object;
  const missing = missingWorkflowFields(obj);
  if (missing.length > 0) {
    return {
      ok: false,
      stage: 'fields',
      issues: ['invalid_json_missing_fields'],
      detail: `JSON 缺少必填字段：${missing.join(', ')}`,
      raw,
    };
  }

  const step = obj.step && typeof obj.step === 'object' ? (obj.step as Record<string, unknown>) : null;
  const input = obj.inputValidation && typeof obj.inputValidation === 'object'
    ? (obj.inputValidation as Record<string, unknown>)
    : null;
  const output = obj.outputValidation && typeof obj.outputValidation === 'object'
    ? (obj.outputValidation as Record<string, unknown>)
    : null;
  const deliver = obj.deliverable && typeof obj.deliverable === 'object'
    ? (obj.deliverable as Record<string, unknown>)
    : null;
  const inputTargets = input ? parseWorkflowStringArray(input.targets) : null;
  const inputLsResults = input ? parseWorkflowStringArray(input.lsResult) : null;
  const outputTargets = output ? parseWorkflowStringArray(output.targets) : null;
  const outputLsResults = output ? parseWorkflowStringArray(output.lsResult) : null;
  const ok =
    typeof obj.role === 'string'
    && !!step
    && typeof step.index === 'number'
    && typeof step.total === 'number'
    && typeof step.title === 'string'
    && !!input
    && inputTargets !== null
    && inputLsResults !== null
    && typeof obj.execution === 'string'
    && !!output
    && outputTargets !== null
    && outputLsResults !== null
    && !!deliver
    && typeof deliver.path === 'string'
    && typeof deliver.summary === 'string'
    && (deliver.conclusion === '通过' || deliver.conclusion === '不通过' || deliver.conclusion === '已交付')
    && typeof obj.rollback === 'string';
  if (!ok) {
    return {
      ok: false,
      stage: 'values',
      issues: ['invalid_json_value'],
      detail: 'JSON 字段值类型或枚举不符合预期（index/total 须为 number；targets/lsResult 须为数组；conclusion 须为 通过/不通过/已交付）',
      raw,
    };
  }
  return {
    ok: true,
    raw,
    repaired: parsedObject.repaired,
    json: {
      role: obj.role as string,
      step: { index: step!.index as number, total: step!.total as number, title: step!.title as string },
      inputValidation: {
        targets: inputTargets!,
        lsResult: inputLsResults!,
      },
      execution: obj.execution as string,
      outputValidation: {
        targets: outputTargets!,
        lsResult: outputLsResults!,
      },
      deliverable: {
        path: deliver!.path as string,
        summary: deliver!.summary as string,
        conclusion: deliver!.conclusion as '通过' | '不通过' | '已交付',
      },
      rollback: obj.rollback as string,
    },
  };
}

/** 从群聊/Session 正文中解析符合 Workflow 节点 schema 的 JSON。 */
export function parseWorkflowJsonOutput(raw: string): WorkflowJsonOutput | null {
  const parsed = parseWorkflowJsonOutputDetailed(raw);
  return parsed.ok ? parsed.json : null;
}

/** 用于判断群聊 JSON 是否在 5 分钟内未变更（仅比较业务字段）。 */
export function canonicalWorkflowJsonFingerprint(output: WorkflowJsonOutput): string {
  return JSON.stringify({
    role: output.role.trim(),
    step: output.step,
    inputValidation: output.inputValidation,
    execution: output.execution.trim(),
    outputValidation: output.outputValidation,
    deliverable: {
      path: output.deliverable.path.trim(),
      summary: output.deliverable.summary.trim(),
      conclusion: output.deliverable.conclusion,
    },
    rollback: output.rollback.trim(),
  });
}

export type WorkflowJsonHealValidationResult =
  | { ok: true; json: WorkflowJsonOutput; raw: string; fingerprint: string }
  | { ok: false; reason: string };

/** @deprecated 收稿后请用 {@link validateWorkflowRoomJsonForRunner}（第 2 步结构化校验）。 */
export function validateWorkflowJsonForRoomHeal(
  progressText: string,
  params: { actorRoleName: string },
): WorkflowJsonHealValidationResult {
  const v = validateWorkflowRoomJsonForRunner(progressText, params);
  if (v.ok) {
    return { ok: true, json: v.json, raw: v.raw, fingerprint: v.fingerprint };
  }
  return { ok: false, reason: v.issues[0] ?? 'invalid' };
}
