import { hasWorkflowStepDraftContent } from '@/lib/office-workflow-step-drafts';
import type { OfficeFixedGroup, OfficeTaskExecutionMode, OfficeTempProject } from '@/types/office';

/** 项目仍绑定到一条存在的固定组记录（派出项目）。 */
export function hasActiveParentFixedGroup(
  project: Pick<OfficeTempProject, 'parentGroupId'> & Partial<Pick<OfficeTempProject, 'origin'>>,
  parentGroup: Pick<OfficeFixedGroup, 'id'> | null | undefined,
): boolean {
  const parentId = project.parentGroupId?.trim();
  if (!parentId || !parentGroup || project.origin !== 'fixed_group') return false;
  return parentGroup.id === parentId;
}

/** 固定组派出的临时项目（父固定组仍存在；执行模式等继承固定组）。 */
export function isFixedGroupSpawnedProject(
  project: Pick<OfficeTempProject, 'parentGroupId'> & Partial<Pick<OfficeTempProject, 'origin'>>,
  parentGroup?: Pick<OfficeFixedGroup, 'id'> | null,
): boolean {
  return hasActiveParentFixedGroup(project, parentGroup);
}

/** 自建项目：原生 standalone，或固定组已删除后的孤儿项目。 */
export function isSelfBuiltOfficeProject(
  project: Pick<OfficeTempProject, 'parentGroupId'>,
  parentGroup?: Pick<OfficeFixedGroup, 'id'> | null,
): boolean {
  return !hasActiveParentFixedGroup(project, parentGroup);
}

/** 固定组执行模式（工作流 / Smart）；未设置时默认为工作流。 */
export function fixedGroupExecutionMode(
  group: Pick<OfficeFixedGroup, 'executionMode'>,
): Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'> {
  return group.executionMode === 'smart' ? 'smart' : 'workflow';
}

export function normalizeGroupExecutionMode(
  mode: OfficeTaskExecutionMode | undefined,
): Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'> {
  return mode === 'smart' ? 'smart' : 'workflow';
}

/** 固定组为工作流模式且已有编排内容（节点表、描述或 workflow 图）。 */
export function fixedGroupHasWorkflowOrchestration(
  group: Partial<
    Pick<
      OfficeFixedGroup,
      | 'executionMode'
      | 'workflowDescription'
      | 'workflowStepDrafts'
      | 'workflow'
    >
  >,
): boolean {
  if (fixedGroupExecutionMode(group) !== 'workflow') return false;
  if (hasWorkflowStepDraftContent(group.workflowStepDrafts)) return true;
  if (group.workflowDescription?.trim()) return true;
  if (group.workflow?.nodes?.length) return true;
  return false;
}

/** 从固定组派出的项目：编排方式须与固定组一致且不可更改。 */
export function spawnedProjectOrchestrationModeLocked(
  group: Partial<
    Pick<
      OfficeFixedGroup,
      | 'executionMode'
      | 'workflowDescription'
      | 'workflowStepDrafts'
      | 'workflow'
    >
  > | null | undefined,
): boolean {
  return Boolean(group && fixedGroupHasWorkflowOrchestration(group));
}
