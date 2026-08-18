import { parseSmartCoordinatorAction } from '@/lib/office-smart-coordinator-dispatch';
import type { SmartFlowSemanticIssue, SmartFlowSemanticsParams } from '@/lib/office-smart-flow-semantics';
import { validateSmartFlowSemantics } from '@/lib/office-smart-flow-semantics';
import { isSmartMemberHelpAction } from '@/lib/office-smart-member-reply';
import {
  isSmartJsonShapeText,
  parseSmartJsonOutputDetailed,
  smartJsonToBracketText,
  type SmartJsonOutput,
  type SmartJsonParseIssue,
} from '@/lib/office-smart-json-schema';
import { validateSmartRoomJsonStructure } from '@/lib/office-smart-json-validate';

/** Smart 四层结构化校验阶段。 */
export type SmartStructuredValidationStage =
  | 'syntax'
  | 'fields'
  | 'values'
  | 'semantics'
  | 'disk';

export type SmartStructuredLayerIssue =
  | SmartJsonParseIssue
  | 'invalid_json_schema'
  | 'deliverable_filename_missing_role_suffix'
  | 'smart_deliverable_output_validation_ls_invalid'
  | SmartFlowSemanticIssue
  | 'smart_deliverable_paths_missing_on_disk';

export type SmartStructuredLayers123Result =
  | {
    ok: true;
    stage: 'semantics';
    json: SmartJsonOutput;
    normalizedRaw: string;
    fingerprint: string;
  }
  | {
    ok: false;
    stage: SmartStructuredValidationStage;
    issues: SmartStructuredLayerIssue[];
    detail: string;
    raw: string;
  };

export type SmartStructuredLayers123Params = {
  raw: string;
  isCoordinator: boolean;
  actorRoleName?: string;
  /** 提供时执行第 3 层流程态语义校验；省略则仅做 JSON 1–3 静态 value。 */
  flow?: Omit<SmartFlowSemanticsParams, 'raw' | 'isCoordinator'>;
};

/** 成员 help：仅认原始 JSON 的 action=help。 */
export function resolveSmartMemberHelpAction(
  inputRaw: string,
  _normalizedRaw?: string,
  isCoordinator?: boolean,
): boolean {
  if (isCoordinator) return false;
  return isSmartMemberHelpAction(inputRaw);
}

/**
 * 第 4 层落盘：成员 help 可跳过；协调者 action=end 仍跑 1–3 层语义，落盘无交付要求时跳过磁盘。
 */
export function shouldSkipSmartStructuredDiskLayer(params: {
  isCoordinator: boolean;
  inputRaw: string;
  normalizedRaw: string;
}): boolean {
  if (resolveSmartMemberHelpAction(params.inputRaw, params.normalizedRaw, params.isCoordinator)) {
    return true;
  }
  if (
    params.isCoordinator
    && (
      parseSmartCoordinatorAction(params.normalizedRaw) === 'end'
      || parseSmartCoordinatorAction(params.inputRaw) === 'end'
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Smart 结构化校验第 1–3 层（同步）：
 * 1 JSON 语法 → 2 必填字段/形态 → 3 静态 value + 流程态语义。
 */
export function runSmartStructuredLayers123(
  params: SmartStructuredLayers123Params,
): SmartStructuredLayers123Result {
  const inputRaw = params.raw.trim();
  if (!inputRaw) {
    return {
      ok: false,
      stage: 'syntax',
      issues: ['invalid_json_syntax'],
      detail: '未收到 JSON 正文',
      raw: inputRaw,
    };
  }

  if (!isSmartJsonShapeText(inputRaw)) {
    return {
      ok: false,
      stage: 'syntax',
      issues: ['invalid_json_syntax'],
      detail: 'Smart 模式须输出 JSON',
      raw: inputRaw,
    };
  }

  const parsedJson = parseSmartJsonOutputDetailed(inputRaw, params.isCoordinator);
  if (!parsedJson.ok) {
    const stage: SmartStructuredValidationStage =
      parsedJson.issues.includes('invalid_json_syntax')
        ? 'syntax'
        : parsedJson.issues.includes('invalid_json_missing_fields')
          ? 'fields'
          : 'values';
    return {
      ok: false,
      stage,
      issues: parsedJson.issues,
      detail: parsedJson.detail,
      raw: inputRaw,
    };
  }

  const structure = validateSmartRoomJsonStructure(inputRaw, {
    isCoordinator: params.isCoordinator,
    actorRoleName: params.actorRoleName,
  });
  if (!structure.ok) {
    return {
      ok: false,
      stage: 'values',
      issues: structure.issues,
      detail: structure.detail,
      raw: inputRaw,
    };
  }

  const normalizedRaw = smartJsonToBracketText(structure.json, params.isCoordinator);

  if (params.flow) {
    const semanticIssues = validateSmartFlowSemantics({
      raw: normalizedRaw,
      jsonRaw: inputRaw,
      isCoordinator: params.isCoordinator,
      ...params.flow,
    });
    if (semanticIssues.length > 0) {
      return {
        ok: false,
        stage: 'semantics',
        issues: semanticIssues,
        detail: `Smart 流程态语义校验未通过：${semanticIssues.join(', ')}`,
        raw: inputRaw,
      };
    }
  }

  return {
    ok: true,
    stage: 'semantics',
    json: structure.json,
    normalizedRaw,
    fingerprint: structure.fingerprint,
  };
}
