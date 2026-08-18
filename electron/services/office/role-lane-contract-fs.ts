import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';

type LaneContractMember = Pick<ProjectAgentRef, 'agentId' | 'displayName'> & {
  id?: string;
  name?: string;
  laneContract?: string;
};

/** @deprecated v2：lane contract 已并入 agent workspace，保留空实现供旧调用链编译。 */
export async function writeRoleLaneContractToDisk(
  _member: LaneContractMember,
  _team: LaneContractMember[],
): Promise<void> {
  // no-op
}

export async function readRoleLaneContractFromDisk(
  _member: LaneContractMember,
): Promise<string | null> {
  return null;
}
