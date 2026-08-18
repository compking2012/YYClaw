import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeOpenClawConfig, readOpenClawConfig } = vi.hoisted(() => ({
  writeOpenClawConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

const notifyOfficeProjectRunStopped = vi.hoisted(() => vi.fn());
const isOfficeProjectRunLifecycleActive = vi.hoisted(() => vi.fn(() => false));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig,
  writeOpenClawConfig,
}));

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  isOfficeProjectRunLifecycleActive,
  notifyOfficeProjectRunStopped,
}));

vi.mock('@electron/services/office/office-workflow-log', () => ({
  officeWorkflowLog: vi.fn(),
}));

import { OFFICE_SPAWN_TOOL_DENY } from '@electron/services/office/office-spawn-policy';
import {
  getOfficeSpawnPolicyActiveProjectsForTest,
  getOfficeSpawnPolicyAgentDenyRefForTest,
  prepareOfficeSpawnDenyBeforeRun,
  releaseOfficeSpawnDenyForOrphanedProjectAbort,
  resetOfficeSpawnPolicyReconcileForTest,
} from '@electron/services/office/office-spawn-policy-reconcile';

describe('releaseOfficeSpawnDenyForOrphanedProjectAbort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOfficeSpawnPolicyReconcileForTest();
    isOfficeProjectRunLifecycleActive.mockReturnValue(false);
    readOpenClawConfig.mockResolvedValue({
      agents: { list: [{ id: 'dev', tools: { deny: [...OFFICE_SPAWN_TOOL_DENY] } }] },
    });
  });

  it('releases spawn deny for orphaned aborts', async () => {
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    writeOpenClawConfig.mockClear();

    await releaseOfficeSpawnDenyForOrphanedProjectAbort('proj-wf');

    expect(getOfficeSpawnPolicyActiveProjectsForTest().has('proj-wf')).toBe(false);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
    expect(notifyOfficeProjectRunStopped).toHaveBeenCalledWith('proj-wf');
  });

  it('defers release while runOfficeProject lifecycle is still active', async () => {
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    isOfficeProjectRunLifecycleActive.mockReturnValue(true);
    writeOpenClawConfig.mockClear();

    await releaseOfficeSpawnDenyForOrphanedProjectAbort('proj-wf');

    expect(getOfficeSpawnPolicyActiveProjectsForTest().has('proj-wf')).toBe(true);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
    expect(notifyOfficeProjectRunStopped).not.toHaveBeenCalled();
  });
});
