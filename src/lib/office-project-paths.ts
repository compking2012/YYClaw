import { projectDirSegment } from '@/lib/office-project-context';
import {
  OFFICE_ROLE_SCOPED_DELIVERABLE_NAMING_LINE,
  OFFICE_ROLE_SCOPED_STATUS_NAMING_LINE,
} from '@/lib/office-project-file-naming';
import {
  officeProjectRootDisplayPath,
  type OfficeRoleWorkspaceRef,
} from '@/lib/office-agent-workspace';

/** Smart / Workflow 共用：相对 workspace 的项目目录片段。 */
export const OFFICE_PROJECT_WORKSPACE_PARTS = ['office', 'projects'] as const;

const defaultOpenClawHome = () =>
  process.env.OPENCLAW_HOME?.trim() || `${process.env.HOME || ''}/.openclaw`;

/**
 * 项目唯一落盘目录（提示词用展示路径）。
 * 协调者 workspace 为 `workspace-<coordinatorAgentId>/office/projects/<projectId>`。
 */
export function officeProjectRootRelative(
  coordinatorRole: OfficeRoleWorkspaceRef,
  teamRoles: OfficeRoleWorkspaceRef[],
  taskTitle: string,
  taskId: string,
  openclawHome: string = defaultOpenClawHome(),
): string {
  return officeProjectRootDisplayPath(
    openclawHome,
    coordinatorRole,
    teamRoles,
    taskTitle,
    taskId,
    projectDirSegment,
  );
}

/** Agent prompt / 规则用：项目目录说明行。 */
export function buildOfficeProjectDirectoryPolicyLines(
  coordinatorRole: OfficeRoleWorkspaceRef,
  teamRoles: OfficeRoleWorkspaceRef[],
  taskTitle: string,
  taskId: string,
  openclawHome: string = defaultOpenClawHome(),
): string[] {
  const root = officeProjectRootRelative(
    coordinatorRole,
    teamRoles,
    taskTitle,
    taskId,
    openclawHome,
  );
  return [
    '【项目目录·唯一】Smart 与 Workflow 所有交付物、校验读取、对外产物生成，均使用下列目录（禁止写入各成员自有 workspace 下的 office/projects）：',
    `- ${root}`,
    '写入时使用上述绝对路径；`ls -l` / stat / 读取上游产物均只在该目录下查找。',
    OFFICE_ROLE_SCOPED_STATUS_NAMING_LINE,
    OFFICE_ROLE_SCOPED_DELIVERABLE_NAMING_LINE,
  ];
}

export const OFFICE_PROJECT_DELIVERABLE_POLICY_LINE =
  '【项目目录】全部交付物（文件或文件夹，按产物类型选择）须写入协调者 agent 的 office/projects/<projectId>/；校验与对外产物只在该目录读写。';
