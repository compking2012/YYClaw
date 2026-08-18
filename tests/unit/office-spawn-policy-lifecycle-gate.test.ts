import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeOpenClawConfig, readOpenClawConfig } = vi.hoisted(() => ({
  writeOpenClawConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig,
  writeOpenClawConfig,
}));

vi.mock('@electron/services/office/office-workflow-log', () => ({
  officeWorkflowLog: vi.fn(),
}));

import {
  getOfficeSpawnPolicyAgentDenyRefForTest,
  prepareOfficeSpawnDenyBeforeRun,
  releaseOfficeSpawnDenyAfterRun,
  resetOfficeSpawnPolicyReconcileForTest,
} from '@electron/services/office/office-spawn-policy-reconcile';
import {
  isOfficeProjectRunLifecycleActive,
  notifyOfficeProjectRunStarted,
  notifyOfficeProjectRunStopped,
  resetOfficeSyncRuntimeForTest,
} from '@electron/services/office/office-sync-runtime';

/** Mirrors runOfficeProject.finally spawn release gate. */
async function releaseSpawnDenyAfterRunOfficeProjectStopped(projectId: string): Promise<void> {
  notifyOfficeProjectRunStopped(projectId);
  if (!isOfficeProjectRunLifecycleActive(projectId)) {
    await releaseOfficeSpawnDenyAfterRun(projectId);
  }
}

describe('spawn deny release gated by office-sync lifecycle ref-count', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOfficeSpawnPolicyReconcileForTest();
    resetOfficeSyncRuntimeForTest();
    readOpenClawConfig.mockResolvedValue({
      agents: { list: [{ id: 'dev', tools: { allow: ['read', 'sessions_spawn'] } }] },
    });
  });

  it('keeps deny after first stop when single mode overlays a full workflow run', async () => {
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    notifyOfficeProjectRunStarted('proj-wf');
    notifyOfficeProjectRunStarted('proj-wf');
    writeOpenClawConfig.mockClear();

    await releaseSpawnDenyAfterRunOfficeProjectStopped('proj-wf');

    expect(isOfficeProjectRunLifecycleActive('proj-wf')).toBe(true);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(writeOpenClawConfig).not.toHaveBeenCalled();

    await releaseSpawnDenyAfterRunOfficeProjectStopped('proj-wf');

    expect(isOfficeProjectRunLifecycleActive('proj-wf')).toBe(false);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
    const saved = writeOpenClawConfig.mock.calls[0]![0] as {
      agents?: { list?: Array<{ tools?: { deny?: string[] } }> };
    };
    expect(saved.agents?.list?.[0]?.tools?.deny).toBeUndefined();
  });

  it('releases deny on single lifecycle stop', async () => {
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    notifyOfficeProjectRunStarted('proj-wf');
    writeOpenClawConfig.mockClear();

    await releaseSpawnDenyAfterRunOfficeProjectStopped('proj-wf');

    expect(isOfficeProjectRunLifecycleActive('proj-wf')).toBe(false);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
  });

  it('prepare is idempotent while lifecycle ref-count stacks', async () => {
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-wf', agentIds: ['dev'] });
    notifyOfficeProjectRunStarted('proj-wf');
    notifyOfficeProjectRunStarted('proj-wf');

    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);

    await releaseSpawnDenyAfterRunOfficeProjectStopped('proj-wf');
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);

    await releaseSpawnDenyAfterRunOfficeProjectStopped('proj-wf');
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
  });
});
