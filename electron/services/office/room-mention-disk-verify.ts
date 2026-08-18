import { shouldSkipSmartStructuredDiskLayer } from '../../../src/lib/office-smart-structured-validation';
import { normalizeSmartMentionRaw } from './room-mention-smart-normalize';
import { isSmartValidationSectionExempt } from '../../../src/lib/office-smart-validation-scope';
import {
  declaredDeliverablePathsFromSmartMemberJson,
  normalizeDeliverablePathForDisk,
} from '../../../src/lib/office-deliverable-disk-resolve';
import {
  inferSmartMemberInputValidationFailed,
  smartInputPathsMissingOnDisk,
} from '../../../src/lib/office-smart-input-validation';
import {
  resolveSmartValidationScope,
} from '../../../src/lib/office-smart-validation-scope';
import type { SmartWorkOrderStep } from '../../../src/lib/office-smart-work-order';
import { extractOfficeBracketSections } from '../../../src/lib/office-workflow-output-sections';
import type { OfficeRole, OfficeScenario, OfficeTask, RoomMessage } from './types';
import {
  formatLsLongLinesForDeliverableHints,
  formatLsLongLinesForPaths,
  resolveTaskCoordinatorProjectRoot,
  verifyDeliverablePathHintsExistOnDisk,
} from './workflow-project-deliverable-fs';

export type SmartMentionDiskVerifyResult = {
  ok: boolean;
  detail: string;
  lsLines: string[];
  missingPaths: string[];
  /** 协调者项目目录（ls 解析根） */
  projectRoot?: string;
  /** 引擎判定【输入校验】路径缺失或段落声明不合格 */
  inputValidationFailed?: boolean;
};

export async function verifySmartMentionStructuredPathsOnDisk(params: {
  raw: string;
  task: Pick<OfficeTask, 'id' | 'title' | 'coordinatorRoleId'>;
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
  role: Pick<OfficeRole, 'id' | 'agentId' | 'name'>;
  teamRoles: Pick<OfficeRole, 'id' | 'agentId' | 'name'>[];
  requireDeliverableFile?: boolean;
  roomMessages?: RoomMessage[];
  steps?: SmartWorkOrderStep[];
  isCoordinator?: boolean;
  memberReportRaw?: string;
  /** 协调者验收时【输入校验】路径解析用的汇报者角色（默认同 role） */
  inputPathRole?: Pick<OfficeRole, 'id' | 'name' | 'agentId'>;
  /** @deprecated 用 {@link inputPathRole}；仅 ls 展示时的角色显示名 */
  memberReportRoleName?: string | null;
}): Promise<SmartMentionDiskVerifyResult> {
  const roleName =
    params.teamRoles.find((r) => r.id === params.role.id)?.name?.trim()
    || params.role.name?.trim()
    || '';
  const verifyBase = {
    project: { id: params.task.id, title: params.task.title },
    member: {
      agentId: params.role.agentId?.trim() || params.role.id,
      displayName: params.role.name?.trim() || params.role.agentId || params.role.id,
    },
    teamMembers: params.teamRoles.map((r) => ({
      agentId: r.agentId?.trim() || r.id,
      displayName: r.name?.trim() || r.agentId || r.id,
    })),
  };
  const norm = normalizeSmartMentionRaw(params.raw, {
    isCoordinator: params.isCoordinator ?? false,
    actorRoleName: roleName,
  });
  const sectionRaw = norm.jsonInvalid ? params.raw.trim() : norm.raw;
  if (
    shouldSkipSmartStructuredDiskLayer({
      isCoordinator: params.isCoordinator ?? false,
      inputRaw: params.raw,
      normalizedRaw: sectionRaw,
    })
  ) {
    const projectRoot = await resolveTaskCoordinatorProjectRoot(verifyBase);
    return { ok: true, detail: '', lsLines: [], missingPaths: [], projectRoot: projectRoot ?? undefined };
  }
  const memberDeliverablePaths = !params.isCoordinator
    ? declaredDeliverablePathsFromSmartMemberJson(params.raw)
    : [];
  const sections = extractOfficeBracketSections(sectionRaw);
  const inputCheck = sections['输入校验'] ?? sections['输入检查'] ?? '';
  const inputPathRole = params.inputPathRole ?? params.role;
  const inputRoleName =
    params.teamRoles.find((r) => r.id === inputPathRole.id)?.name?.trim()
    || inputPathRole.name?.trim()
    || roleName;

  const scope =
    params.roomMessages && params.steps
      ? resolveSmartValidationScope({
          raw: sectionRaw,
          viewerRoleId: params.role.id,
          steps: params.steps,
          roomMessages: params.roomMessages,
          taskId: params.task.id,
          isCoordinator: params.isCoordinator,
          memberReportRaw: params.memberReportRaw,
        })
      : null;
  const inputPaths = scope?.inputPaths.map((p) => normalizeDeliverablePathForDisk(p)).filter(Boolean) ?? [];
  const allPaths = [...new Set([...inputPaths, ...memberDeliverablePaths])];

  const sectionIssues: string[] = [];
  if (inputPaths.length > 0 && isSmartValidationSectionExempt(inputCheck)) {
    sectionIssues.push('【输入校验】须说明上一跳交付物路径或写「无」（系统将校验文件/文件夹是否存在）');
  }

  const projectRoot = await resolveTaskCoordinatorProjectRoot(verifyBase);

  const inputDisk =
    inputPaths.length > 0
      ? await verifyDeliverablePathHintsExistOnDisk({
          ...verifyBase,
          member: {
            agentId: inputPathRole.agentId?.trim() || inputPathRole.id,
            displayName: inputRoleName || inputPathRole.id,
          },
          pathHints: inputPaths,
          sectionLabel: '输入校验',
          submittingRoleName: inputRoleName,
        })
      : { ok: true, detail: '', missingHints: [] as string[], resolvedPaths: [] as string[] };

  const lsRoleName =
    params.memberReportRoleName?.trim()
    || (inputPaths.length > 0 ? inputRoleName : roleName);
  const lsLines =
    allPaths.length > 0 && projectRoot
      ? (
          await formatLsLongLinesForDeliverableHints(allPaths, {
            projectRoot,
            roleName: lsRoleName,
          })
        ).lines
      : [];

  const inputPathsMissing = inputPaths.length > 0 && !inputDisk.ok;
  const inputValidationFailed = inferSmartMemberInputValidationFailed({
    inputCheck,
    inputPathsMissingOnDisk: inputPathsMissing,
  });

  const existenceIssues = [
    ...sectionIssues,
    ...(!inputDisk.ok ? [inputDisk.detail] : []),
  ];
  if (existenceIssues.length > 0) {
    const engineHint =
      lsLines.length > 0 ? `\n引擎核验参考：\n${lsLines.join('\n')}` : '';
    return {
      ok: false,
      detail: `${existenceIssues.join('；')}${engineHint}`,
      lsLines,
      missingPaths: [
        ...new Set([
          ...inputDisk.missingHints,
        ]),
      ],
      projectRoot: projectRoot ?? undefined,
      inputValidationFailed,
    };
  }

  if (!params.requireDeliverableFile && allPaths.length === 0) {
    return { ok: true, detail: '', lsLines, missingPaths: [], projectRoot: projectRoot ?? undefined };
  }

  // 协调者处理成员汇报：无自交付落盘，跳过【交付产物】段落磁盘层。
  if (params.isCoordinator && params.memberReportRaw?.trim()) {
    return {
      ok: true,
      detail: '',
      lsLines,
      missingPaths: [],
      projectRoot: projectRoot ?? undefined,
      inputValidationFailed: false,
    };
  }

  const disk = memberDeliverablePaths.length > 0
    ? await verifyDeliverablePathHintsExistOnDisk({
        ...verifyBase,
        pathHints: memberDeliverablePaths,
        sectionLabel: '交付产物',
      })
    : params.requireDeliverableFile
      ? {
          ok: false,
          detail: '【交付产物】未声明 deliverable.items（Smart JSON 或【交付产物】段落须列出落盘路径）',
          missingHints: [] as string[],
          resolvedPaths: [] as string[],
        }
      : { ok: true, detail: '', missingHints: [] as string[], resolvedPaths: [] as string[] };

  if (!disk.ok) {
    const ref =
      lsLines.length > 0
        ? `\n${lsLines.join('\n')}`
        : allPaths.length > 0
          ? `\n请确认 ${allPaths.join('；')} 已写入协调者项目目录`
          : '';
    return {
      ok: false,
      detail: `${disk.detail}${ref}`,
      lsLines,
      missingPaths: disk.missingHints,
      projectRoot: projectRoot ?? undefined,
      inputValidationFailed:
        inputValidationFailed || inputPathsMissing,
    };
  }

  return {
    ok: true,
    detail: '',
    lsLines,
    missingPaths: [],
    projectRoot: projectRoot ?? undefined,
    inputValidationFailed: false,
  };
}

/** 对绝对路径列表做存在性核验（无 task 上下文时用 ls 结果行判定）。 */
export async function verifySmartUpstreamDeliverablePathsOnDisk(
  paths: string[],
  verifyParams?: {
    task: Pick<OfficeTask, 'id' | 'title' | 'coordinatorRoleId'>;
    scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
    role: Pick<OfficeRole, 'id' | 'name' | 'agentId'>;
    teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[];
  },
): Promise<SmartMentionDiskVerifyResult> {
  const unique = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return { ok: true, detail: '', lsLines: [], missingPaths: [] };
  }

  if (verifyParams) {
    const diskCtx = {
      project: { id: verifyParams.task.id, title: verifyParams.task.title },
      member: {
        agentId: verifyParams.role.agentId?.trim() || verifyParams.role.id,
        displayName:
          verifyParams.role.name?.trim() || verifyParams.role.agentId || verifyParams.role.id,
      },
      teamMembers: verifyParams.teamRoles.map((r) => ({
        agentId: r.agentId?.trim() || r.id,
        displayName: r.name?.trim() || r.agentId || r.id,
      })),
    };
    const projectRoot = await resolveTaskCoordinatorProjectRoot(diskCtx);
    const roleName =
      verifyParams.teamRoles.find((r) => r.id === verifyParams.role.id)?.name?.trim()
      || verifyParams.role.name?.trim()
      || null;
    const disk = await verifyDeliverablePathHintsExistOnDisk({
      ...diskCtx,
      pathHints: unique,
      sectionLabel: '输入校验',
    });
    const lsLines =
      projectRoot
        ? (await formatLsLongLinesForDeliverableHints(unique, { projectRoot, roleName })).lines
        : [];
    if (!disk.ok) {
      return {
        ok: false,
        detail: `上一跳交付物存在性核验未通过：${disk.detail}`,
        lsLines,
        missingPaths: disk.missingHints,
        projectRoot: projectRoot ?? undefined,
        inputValidationFailed: true,
      };
    }
    return {
      ok: true,
      detail: '',
      lsLines,
      missingPaths: [],
      projectRoot: projectRoot ?? undefined,
    };
  }

  const lsLines = await formatLsLongLinesForPaths(unique);
  const inputPathsMissing = smartInputPathsMissingOnDisk(unique, lsLines);
  if (inputPathsMissing || lsLines.some((l) => /cannot access|not found/iu.test(l))) {
    return {
      ok: false,
      detail: `上一跳交付路径磁盘核验未通过：\n${lsLines.join('\n')}`,
      lsLines,
      missingPaths: unique,
      inputValidationFailed: true,
    };
  }
  return { ok: true, detail: '', lsLines, missingPaths: [] };
}
