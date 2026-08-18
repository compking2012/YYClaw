import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import { hasActiveParentFixedGroup } from '@/lib/office-fixed-group';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

export type SpawnedProjectAgentSyncDiff = {
  addedAgentIds: string[];
  removedAgentIds: string[];
  changed: boolean;
};

export type SpawnedProjectAgentSyncNotice = SpawnedProjectAgentSyncDiff & {
  groupId: string;
  groupName: string;
};

export function describeSpawnedProjectAgentDrift(
  project: Pick<OfficeTempProject, 'agentIds'>,
  group: Pick<OfficeFixedGroup, 'agentIds'>,
): SpawnedProjectAgentSyncDiff {
  const projectSet = new Set(project.agentIds);
  const groupSet = new Set(group.agentIds);
  const addedAgentIds = group.agentIds.filter((id) => !projectSet.has(id));
  const removedAgentIds = project.agentIds.filter((id) => !groupSet.has(id));
  return {
    addedAgentIds,
    removedAgentIds,
    changed: addedAgentIds.length > 0 || removedAgentIds.length > 0,
  };
}

export function buildSpawnedProjectAgentSyncNotice(
  project: Pick<OfficeTempProject, 'parentGroupId' | 'agentIds'>,
  parentGroup: Pick<OfficeFixedGroup, 'id' | 'name' | 'agentIds'> | null | undefined,
): SpawnedProjectAgentSyncNotice | null {
  if (!hasActiveParentFixedGroup(project, parentGroup) || !parentGroup) return null;
  const drift = describeSpawnedProjectAgentDrift(project, parentGroup);
  if (!drift.changed) return null;
  return {
    groupId: parentGroup.id,
    groupName: parentGroup.name,
    ...drift,
  };
}

/** 派出项目归档重启前：成员与当前固定组对齐（增删 agent、协调者随组）。 */
export function syncSpawnedProjectAgentsWithGroup(
  project: OfficeTempProject,
  group: Pick<OfficeFixedGroup, 'agentIds' | 'coordinatorAgentId'>,
): OfficeTempProject {
  const agentIds = [...group.agentIds];
  const coordinatorAgentId = ensureCoordinatorInTeam(
    group.coordinatorAgentId,
    agentIds,
    agentIds[0] ?? project.coordinatorAgentId,
  );
  return {
    ...project,
    agentIds,
    coordinatorAgentId,
  };
}
