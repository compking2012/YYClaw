import {
  validateSmartJsonDeliverableItems,
  validateSmartMemberDeliverableItems,
} from '@/lib/office-deliverable-file-policy';
import {
  canonicalSmartJsonFingerprint,
  parseSmartJsonOutputDetailed,
  type SmartJsonOutput,
  type SmartJsonParseIssue,
} from '@/lib/office-smart-json-schema';

export type SmartRoomJsonValidationResult =
  | {
      ok: true;
      json: SmartJsonOutput;
      raw: string;
      fingerprint: string;
    }
  | {
      ok: false;
      issues: Array<
        SmartJsonParseIssue
        | 'invalid_json_schema'
        | 'deliverable_filename_missing_role_suffix'
      >;
      detail: string;
      raw: string;
    };

function fieldPresent(v: string | undefined | null): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

const ABSOLUTE_DELIVERABLE_NAME_RE = /^(?:\/|~\/|[A-Za-z]:[\\/])/u;

function smartDeliverableNamesValid(names: string[]): boolean {
  return names.every((name) => {
    const t = name.trim();
    if (!t || /^无$/iu.test(t)) return false;
    if (ABSOLUTE_DELIVERABLE_NAME_RE.test(t)) return false;
    if (/[`"'<>|]/u.test(t)) return false;
    return true;
  });
}

function isNoDispatchValue(v: string): boolean {
  const t = v.trim();
  return !t || /^无$/iu.test(t);
}

function validateSmartDispatchShape(
  dispatch: import('@/lib/office-smart-json-schema').SmartDispatch,
  raw: string,
  params: { isCoordinator: boolean; action: import('@/lib/office-smart-json-schema').SmartDispatchAction },
): SmartRoomJsonValidationResult | null {
  if (params.action === 'help' && params.isCoordinator) {
    return { ok: false, issues: ['invalid_json_value'], detail: 'action=help 仅允许 Smart 成员向协调者求助，协调者禁止使用', raw };
  }
  if (params.action === 'review') {
    const detail = params.isCoordinator
      ? 'Smart 协调者 action 仅允许 "assign" 或 "end"，已移除 review'
      : 'Smart 成员 action 仅允许 "end" 或 "help"，禁止使用 review';
    return { ok: false, issues: ['invalid_json_value'], detail, raw };
  }

  if (params.isCoordinator && params.action === 'assign') {
    if (dispatch.length === 0) {
      return { ok: false, issues: ['invalid_json_value'], detail: 'action=assign 时 dispatch 至少包含 1 项', raw };
    }
    for (const item of dispatch) {
      if (isNoDispatchValue(item.role) || isNoDispatchValue(item.task)) {
        return { ok: false, issues: ['invalid_json_value'], detail: 'action=assign 时 dispatch[].role/task 不能为空或「无」', raw };
      }
    }
    return null;
  }

  if (params.isCoordinator && params.action === 'end') {
    const allNoop = dispatch.length === 0 || dispatch.every(
      (item) => isNoDispatchValue(item.role) && isNoDispatchValue(item.task),
    );
    if (!allNoop) {
      return { ok: false, issues: ['invalid_json_value'], detail: 'action=end 时 dispatch 必须为空数组或仅包含 role/task 均为「无」的占位项', raw };
    }
    return null;
  }

  const actionRequiresDispatch =
    params.action === 'help'
    || (!params.isCoordinator && params.action === 'end');
  if (actionRequiresDispatch) {
    if (dispatch.length === 0) {
      return { ok: false, issues: ['invalid_json_value'], detail: `action=${params.action} 时 dispatch 至少包含 1 项`, raw };
    }
    for (const item of dispatch) {
      if (isNoDispatchValue(item.role) || isNoDispatchValue(item.task)) {
        return { ok: false, issues: ['invalid_json_value'], detail: `action=${params.action} 时 dispatch[].role/task 不能为空或「无」`, raw };
      }
    }
    return null;
  }

  return null;
}

/** Smart JSON 结构化校验（不检查 deliverable.outputValidation / Workflow lsResult；字数上限仅作模型参考）。 */
export function validateSmartRoomJsonStructure(
  progressText: string,
  params: { isCoordinator: boolean; actorRoleName?: string },
): SmartRoomJsonValidationResult {
  const raw = progressText.trim();
  if (!raw) {
    return { ok: false, issues: ['invalid_json_syntax'], detail: '未收到 JSON 正文', raw };
  }

  const parsedJson = parseSmartJsonOutputDetailed(raw, params.isCoordinator);
  if (!parsedJson.ok) {
    return { ok: false, issues: parsedJson.issues, detail: parsedJson.detail, raw };
  }
  const json = parsedJson.json;

  const actor = params.actorRoleName?.trim();
  if (actor && json.role.trim() !== actor) {
    return { ok: false, issues: ['invalid_json_value'], detail: `Smart JSON role 不匹配：期望 ${actor}，实际 ${json.role}`, raw };
  }

  if (!fieldPresent(json.taskUnderstanding.trim())) {
    return { ok: false, issues: ['invalid_json_value'], detail: 'taskUnderstanding 不能为空', raw };
  }
  if (params.isCoordinator) {
    const coord = json as import('@/lib/office-smart-json-schema').SmartCoordinatorJsonOutput;
    const dispatchIssue = validateSmartDispatchShape(coord.dispatch, raw, { ...params, action: coord.action });
    if (dispatchIssue) return dispatchIssue;
    const actionNorm = coord.action;
    if (actionNorm !== 'assign' && actionNorm !== 'end') {
      return { ok: false, issues: ['invalid_json_value'], detail: 'Smart 协调者 action 须为 "assign" 或 "end"', raw };
    }
    if (!smartDeliverableNamesValid(coord.deliverable.items)) {
      return { ok: false, issues: ['invalid_json_value'], detail: '协调者 deliverable 仅允许填写交付物相对路径数组；无自交付时必须为空数组 []', raw };
    }
    if (
      coord.deliverable.items.length > 0
      && actor
      && !validateSmartJsonDeliverableItems(actor, coord.deliverable.items)
    ) {
      return {
        ok: false,
        issues: ['deliverable_filename_missing_role_suffix'],
        detail: '协调者 deliverable.items 须落在 交付物-角色名/ 目录下（目录或目录内文件），禁止 target/ 或项目根散落文件',
        raw,
      };
    }
    if (!fieldPresent(coord.inputValidation.trim())) {
      return { ok: false, issues: ['invalid_json_value'], detail: 'inputValidation 不能为空', raw };
    }
  } else {
    const member = json as import('@/lib/office-smart-json-schema').SmartMemberJsonOutput;
    const memberAction = member.action;
    if (memberAction === 'review') {
      return { ok: false, issues: ['invalid_json_value'], detail: 'Smart 成员 action 仅允许 "end" 或 "help"，禁止使用 review', raw };
    }
    if (memberAction !== 'end' && memberAction !== 'help') {
      return { ok: false, issues: ['invalid_json_value'], detail: 'Smart 成员 action 仅允许 "end" 或 "help"，禁止使用 "assign"', raw };
    }
    const dispatchIssue = validateSmartDispatchShape(member.dispatch, raw, { ...params, action: memberAction });
    if (dispatchIssue) return dispatchIssue;
    const memberHelp = memberAction === 'help';
    if (!memberHelp) {
      if (member.deliverable.items.length === 0) {
        return { ok: false, issues: ['invalid_json_value'], detail: '成员完成交付时 deliverable 必须至少包含 1 个交付物名称', raw };
      }
      if (!smartDeliverableNamesValid(member.deliverable.items)) {
        return { ok: false, issues: ['invalid_json_value'], detail: '成员 deliverable 仅允许填写交付物相对路径数组，禁止空值/「无」/绝对路径/非法字符', raw };
      }
      if (
        actor
        && !validateSmartMemberDeliverableItems(actor, member.deliverable.items)
      ) {
        return {
          ok: false,
          issues: ['deliverable_filename_missing_role_suffix'],
          detail: '成员 deliverable.items 须落在 交付物-角色名/ 目录下（目录或目录内文件），禁止 target/ 或项目根散落文件',
          raw,
        };
      }
    } else if (!smartDeliverableNamesValid(member.deliverable.items) && member.deliverable.items.length > 0) {
      return { ok: false, issues: ['invalid_json_value'], detail: 'action=help 时 deliverable.items 应为空数组 []，或仅在确有可核验交付物时填写合法名称', raw };
    }
  }

  return {
    ok: true,
    json,
    raw,
    fingerprint: canonicalSmartJsonFingerprint(json),
  };
}
