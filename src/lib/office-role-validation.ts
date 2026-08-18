export type OfficeRoleValidationCode =
  | 'NAME_REQUIRED'
  | 'NAME_TOO_LONG'
  | 'AGENT_ID_INVALID'
  | 'AGENT_ALREADY_BOUND';

export type OfficeRoleRef = {
  id: string;
  agentId: string;
  name: string;
};

export interface OfficeRoleValidationIssue {
  code: OfficeRoleValidationCode;
  field?: 'name' | 'agentId';
}

const NAME_MAX = 64;
const AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,47}$/i;

/** 是否已有其他角色占用该 agent（单 agent 仅允许绑定一个 Office 角色）。 */
export function findRoleBoundToAgent(
  agentId: string,
  existingRoles: OfficeRoleRef[],
  excludeRoleId?: string,
): OfficeRoleRef | null {
  const id = agentId.trim();
  if (!id) return null;
  const hit = existingRoles.find(
    (r) => r.agentId.trim() === id && r.id !== (excludeRoleId?.trim() ?? ''),
  );
  return hit ?? null;
}

export function validateRoleForm(input: {
  name: string;
  agentId?: string;
  editing: boolean;
  editingRoleId?: string;
  existingRoles?: OfficeRoleRef[];
}): OfficeRoleValidationIssue[] {
  const issues: OfficeRoleValidationIssue[] = [];
  const name = input.name.trim();
  const agentId = (input.agentId ?? '').trim();

  if (!name) {
    issues.push({ code: 'NAME_REQUIRED', field: 'name' });
  } else if (name.length > NAME_MAX) {
    issues.push({ code: 'NAME_TOO_LONG', field: 'name' });
  }

  if (!input.editing && agentId && !AGENT_ID_RE.test(agentId)) {
    issues.push({ code: 'AGENT_ID_INVALID', field: 'agentId' });
  }

  const bound = findRoleBoundToAgent(
    agentId,
    input.existingRoles ?? [],
    input.editingRoleId,
  );
  if (bound) {
    issues.push({ code: 'AGENT_ALREADY_BOUND', field: 'agentId' });
  }

  return issues;
}

export function issueMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  issue: OfficeRoleValidationIssue,
  context?: { boundRoleName?: string },
): string {
  if (issue.code === 'AGENT_ALREADY_BOUND') {
    return t('roleForm.errors.AGENT_ALREADY_BOUND', {
      roleName: context?.boundRoleName ?? '',
    });
  }
  return t(`roleForm.errors.${issue.code}`, { max: NAME_MAX });
}
