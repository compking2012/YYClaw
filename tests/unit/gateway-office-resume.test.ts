import { describe, expect, it, vi } from 'vitest';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  isGatewayInterruptTransportError,
  isGatewayReadyForOfficeExecution,
  projectNeedsGatewayResume,
} from '@electron/services/office/gateway-office-resume';
import { shouldAbortOfficeTasksOnGatewayStateChange } from '@electron/services/office/task-run';

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'project-1',
    title: 'Test',
    status: 'running',
    lifecycle: 'active',
    executionMode: 'workflow',
    agentIds: ['agent-a'],
    nodeRuns: [{ nodeId: 'gen-1', status: 'running' }],
    updatedAt: Date.now(),
    ...overrides,
  } as OfficeTempProject;
}

describe('gateway office resume helpers', () => {
  it('isGatewayReadyForOfficeExecution requires running and gatewayReady', () => {
    expect(isGatewayReadyForOfficeExecution({ state: 'running', gatewayReady: true })).toBe(true);
    expect(isGatewayReadyForOfficeExecution({ state: 'running', gatewayReady: undefined })).toBe(true);
    expect(isGatewayReadyForOfficeExecution({ state: 'running', gatewayReady: false })).toBe(false);
    expect(isGatewayReadyForOfficeExecution({ state: 'starting', gatewayReady: true })).toBe(false);
  });

  it('detects gateway interrupt transport errors', () => {
    expect(isGatewayInterruptTransportError('Request was aborted')).toBe(true);
    expect(isGatewayInterruptTransportError('transcript tail is not resumable')).toBe(true);
    expect(isGatewayInterruptTransportError('deliverable.path 未声明')).toBe(false);
  });

  it('projectNeedsGatewayResume covers orphaned running projects', () => {
    expect(projectNeedsGatewayResume(project())).toBe(true);
  });

  it('projectNeedsGatewayResume ignores archived and failed non-gateway errors', () => {
    expect(
      projectNeedsGatewayResume(
        project({
          lifecycle: 'archived',
        }),
      ),
    ).toBe(false);
    expect(
      projectNeedsGatewayResume(
        project({
          status: 'failed',
          nodeRuns: [{ nodeId: 'gen-1', status: 'failed', error: 'No roles assigned' }],
        }),
      ),
    ).toBe(false);
  });

  it('projectNeedsGatewayResume reopens gateway-interrupted failed projects', () => {
    expect(
      projectNeedsGatewayResume(
        project({
          status: 'failed',
          nodeRuns: [{ nodeId: 'gen-5', status: 'failed', error: 'Request was aborted' }],
        }),
      ),
    ).toBe(true);
  });
});

describe('shouldAbortOfficeTasksOnGatewayStateChange', () => {
  it('does not abort on transient reconnecting/starting transitions', () => {
    expect(shouldAbortOfficeTasksOnGatewayStateChange('running', 'reconnecting')).toBe(false);
    expect(shouldAbortOfficeTasksOnGatewayStateChange('running', 'starting')).toBe(false);
  });

  it('aborts immediately only on error, not transient stopped', () => {
    expect(shouldAbortOfficeTasksOnGatewayStateChange('running', 'stopped')).toBe(false);
    expect(shouldAbortOfficeTasksOnGatewayStateChange('running', 'error')).toBe(true);
  });
});

describe('resumeOrphanedOfficeProjectsAfterGatewayReady', () => {
  it('continues orphaned projects when gateway becomes ready', async () => {
    vi.resetModules();
    const runOfficeProject = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@electron/services/office/store', () => ({
      listTempProjects: vi.fn().mockResolvedValue([
        project({ id: 'project-resume-1', status: 'running' }),
      ]),
      listFixedGroups: vi.fn().mockResolvedValue([]),
    }));
    vi.doMock('@electron/services/office/office-spawn-policy-reconcile', () => ({
      rebuildOfficeSpawnPolicyRefsFromStore: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@electron/services/office/task-run', () => ({
      runOfficeProject,
    }));

    const { resumeOrphanedOfficeProjectsAfterGatewayReady } = await import(
      '@electron/services/office/gateway-office-resume'
    );
    const gateway = {
      getStatus: () => ({ state: 'running', gatewayReady: true }),
      isConnected: () => true,
    };

    await resumeOrphanedOfficeProjectsAfterGatewayReady(gateway as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runOfficeProject).toHaveBeenCalledWith(
      gateway,
      expect.objectContaining({ id: 'project-resume-1' }),
      expect.anything(),
      { mode: 'continue' },
    );
  });
});
