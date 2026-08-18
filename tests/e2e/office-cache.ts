import type { ElectronApplication, Page } from '@playwright/test';
import { expect, installIpcMocks } from './fixtures/electron';

export const STALE_OFFICE_SNAPSHOT_TITLE = 'STALE-E2E-SNAPSHOT';

/**
 * 在 Main 进程包装 host:invoke（仅测试进程内 globalThis 状态，不修改产物源码）。
 * 须在 installIpcMocks 之后调用，以便链式包装已有 handler。
 */
export async function installOfficeCacheTestHooks(app: ElectronApplication): Promise<void> {
  await app.evaluate((staleTitle) => {
    const state = {
      staleSnapshotTitle: staleTitle,
      snapshotGate: null as { release: () => void; promise: Promise<void> } | null,
      staleApplied: false,
      preferredRoomMocks: null as null | {
        runningProjectId: string;
        idleProjectId: string;
        runningMarker: string;
        idleMarker: string;
      },
      reworkProgressMock: null as null | {
        projectId: string;
        agentId: string;
        nodeId: string;
        progressText: string;
        content: string;
      },
      missingAgentInject: null as null | {
        groupNameIncludes?: string;
        projectTitleIncludes?: string;
        ghostId: string;
        markArchived?: boolean;
      },
    };
    (globalThis as unknown as { __clawxOfficeE2eTest?: typeof state }).__clawxOfficeE2eTest = state;

    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type HostHandler = (event: unknown, request: unknown) => Promise<unknown>;
    const getHandler = (): HostHandler | undefined =>
      (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers?.get('host:invoke');
    const current = getHandler();
    if (!current) throw new Error('host:invoke handler missing; call installIpcMocks first');

    const isSnapshotFetch = (request: unknown): boolean => {
      if (!request || typeof request !== 'object') return false;
      const record = request as { module?: string; action?: string; payload?: { path?: string } };
      return record.module === 'legacy'
        && record.action === 'fetch'
        && typeof record.payload?.path === 'string'
        && record.payload.path.startsWith('/api/office/snapshot');
    };

    const mutateSnapshotToStale = (response: unknown): unknown => {
      if (!response || typeof response !== 'object') return response;
      const host = response as { ok?: boolean; data?: { status?: number; body?: Record<string, unknown> } };
      if (!host.ok || !host.data || host.data.status !== 200 || !host.data.body) return response;
      const body = host.data.body;
      const template = Array.isArray(body.tempProjects) ? body.tempProjects[0] as Record<string, unknown> : undefined;
      const agentIds = Array.isArray(template?.agentIds) ? template.agentIds as string[] : [];
      const coordinatorAgentId =
        typeof template?.coordinatorAgentId === 'string' ? template.coordinatorAgentId : agentIds[0] ?? '';
      const staleProject = {
        id: 'stale-e2e-project',
        title: staleTitle,
        origin: 'standalone',
        agentIds,
        coordinatorAgentId,
        lifecycle: 'active',
        featureDescription: 'stale e2e',
        description: '',
        status: 'pending',
        nodeRuns: [],
        sequence: 1,
        updatedAt: Date.now(),
      };
      return {
        ...host,
        data: {
          ...host.data,
          body: { ...body, tempProjects: [staleProject] },
        },
      };
    };

    const patchSnapshotRunning = (response: unknown, runningProjectId: string): unknown => {
      if (!response || typeof response !== 'object') return response;
      const host = response as { ok?: boolean; data?: { status?: number; body?: Record<string, unknown> } };
      if (!host.ok || !host.data || host.data.status !== 200 || !host.data.body) return response;
      const body = host.data.body;
      const projects = Array.isArray(body.tempProjects) ? [...body.tempProjects as Record<string, unknown>[]] : [];
      const next = projects.map((project) => {
        if (project.id !== runningProjectId) return project;
        const coordinatorAgentId =
          typeof project.coordinatorAgentId === 'string'
            ? project.coordinatorAgentId
            : Array.isArray(project.agentIds)
              ? String(project.agentIds[0] ?? '')
              : '';
        return {
          ...project,
          status: 'running',
          nodeRuns: [{
            nodeId: 'e2e-node',
            agentId: coordinatorAgentId,
            status: 'running',
            startedAt: Date.now(),
          }],
          updatedAt: Date.now(),
        };
      });
      return {
        ...host,
        data: {
          ...host.data,
          body: { ...body, tempProjects: next },
        },
      };
    };

    const patchSnapshotReworkPending = (
      response: unknown,
      mock: { projectId: string; agentId: string; nodeId: string },
    ): unknown => {
      if (!response || typeof response !== 'object') return response;
      const host = response as { ok?: boolean; data?: { status?: number; body?: Record<string, unknown> } };
      if (!host.ok || !host.data || host.data.status !== 200 || !host.data.body) return response;
      const body = host.data.body;
      const projects = Array.isArray(body.tempProjects) ? [...body.tempProjects as Record<string, unknown>[]] : [];
      const next = projects.map((project) => {
        if (project.id !== mock.projectId) return project;
        return {
          ...project,
          status: 'running',
          nodeRuns: [{
            nodeId: mock.nodeId,
            agentId: mock.agentId,
            status: 'pending',
            error: '【回滚说明】已触发工作流回滚',
            completionSource: 'room_heal',
          }],
          updatedAt: Date.now(),
        };
      });
      return {
        ...host,
        data: {
          ...host.data,
          body: { ...body, tempProjects: next },
        },
      };
    };

    const injectMissingAgentIntoSnapshot = (
      response: unknown,
      inject: {
        groupNameIncludes?: string;
        projectTitleIncludes?: string;
        ghostId: string;
        markArchived?: boolean;
      },
    ): unknown => {
      if (!response || typeof response !== 'object') return response;
      const host = response as { ok?: boolean; data?: { status?: number; body?: Record<string, unknown> } };
      if (!host.ok || !host.data || host.data.status !== 200 || !host.data.body) return response;
      const body = host.data.body;
      const ghostId = inject.ghostId;
      const groups = Array.isArray(body.fixedGroups) && inject.groupNameIncludes
        ? (body.fixedGroups as Record<string, unknown>[]).map((group) => {
          const name = typeof group.name === 'string' ? group.name : '';
          if (!name.includes(inject.groupNameIncludes!)) return group;
          const agentIds = Array.isArray(group.agentIds) ? [...group.agentIds as string[]] : [];
          if (!agentIds.includes(ghostId)) agentIds.push(ghostId);
          const workflow = group.workflow && typeof group.workflow === 'object'
            ? group.workflow as { nodes?: Record<string, unknown>[] }
            : undefined;
          const nodes = Array.isArray(workflow?.nodes)
            ? workflow!.nodes!.map((node, index) => (
              index === 0
                ? { ...node, agentId: ghostId, agentIds: [ghostId] }
                : node
            ))
            : workflow?.nodes;
          return {
            ...group,
            agentIds,
            agentNameHints: {
              ...(typeof group.agentNameHints === 'object' && group.agentNameHints
                ? group.agentNameHints as Record<string, string>
                : {}),
              [ghostId]: 'E2E Ghost Agent',
            },
            workflow: workflow ? { ...workflow, nodes } : group.workflow,
          };
        })
        : body.fixedGroups;
      const projects = Array.isArray(body.tempProjects)
        ? (body.tempProjects as Record<string, unknown>[]).map((project) => {
          const title = typeof project.title === 'string' ? project.title : '';
          const matchGroupChild = Boolean(inject.groupNameIncludes) && project.parentGroupId != null;
          const matchStandalone = Boolean(inject.projectTitleIncludes)
            && title.includes(inject.projectTitleIncludes!);
          if (!matchGroupChild && !matchStandalone) return project;
          const agentIds = Array.isArray(project.agentIds) ? [...project.agentIds as string[]] : [];
          if (!agentIds.includes(ghostId)) agentIds.push(ghostId);
          return {
            ...project,
            agentIds,
            agentNameHints: {
              ...(typeof project.agentNameHints === 'object' && project.agentNameHints
                ? project.agentNameHints as Record<string, string>
                : {}),
              [ghostId]: 'E2E Ghost Agent',
            },
            ...(inject.markArchived
              ? { lifecycle: 'completed', status: 'completed' }
              : {}),
          };
        })
        : body.tempProjects;
      return {
        ...host,
        data: {
          ...host.data,
          body: { ...body, fixedGroups: groups, tempProjects: projects },
        },
      };
    };

    const roomMessagesResponse = (requestId: unknown, projectId: string, content: string) => ({
      id: typeof requestId === 'string' ? requestId : undefined,
      ok: true,
      data: {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: {
          success: true,
          messages: [{
            id: `e2e-${projectId}`,
            projectId,
            from: 'system',
            content,
            mentions: [],
            timestamp: Date.now(),
          }],
        },
      },
    });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request) => {
      const testState = (globalThis as unknown as { __clawxOfficeE2eTest?: typeof state }).__clawxOfficeE2eTest;
      const record = request as { id?: string; module?: string; action?: string; payload?: { path?: string } };
      const path = record.payload?.path;

      if (testState?.preferredRoomMocks && record.module === 'legacy' && record.action === 'fetch' && typeof path === 'string') {
        const match = path.match(/^\/api\/office\/projects\/([^/]+)\/room\/messages/);
        if (match) {
          const projectId = decodeURIComponent(match[1]!);
          const mocks = testState.preferredRoomMocks;
          if (projectId === mocks.runningProjectId) {
            return roomMessagesResponse(record.id, projectId, mocks.runningMarker);
          }
          if (projectId === mocks.idleProjectId) {
            return roomMessagesResponse(record.id, projectId, mocks.idleMarker);
          }
        }
      }

      if (testState?.reworkProgressMock && record.module === 'legacy' && record.action === 'fetch' && typeof path === 'string') {
        const match = path.match(/^\/api\/office\/projects\/([^/]+)\/room\/messages/);
        if (match) {
          const projectId = decodeURIComponent(match[1]!);
          const mock = testState.reworkProgressMock;
          if (projectId === mock.projectId) {
            return {
              id: typeof record.id === 'string' ? record.id : undefined,
              ok: true,
              data: {
                status: 200,
                headers: { 'content-type': 'application/json; charset=utf-8' },
                body: {
                  success: true,
                  messages: [{
                    id: `e2e-rework-${projectId}`,
                    projectId,
                    from: mock.agentId,
                    fromAgentId: mock.agentId,
                    content: mock.content,
                    progressText: mock.progressText,
                    phase: 'task_running',
                    nodeId: mock.nodeId,
                    mentions: [],
                    timestamp: Date.now(),
                  }],
                },
              },
            };
          }
        }
      }

      if (testState?.snapshotGate && isSnapshotFetch(request) && !testState.staleApplied) {
        await testState.snapshotGate.promise;
        testState.staleApplied = true;
        return mutateSnapshotToStale(await current(event, request));
      }

      const response = await current(event, request);
      let nextResponse = response;
      if (testState?.preferredRoomMocks && isSnapshotFetch(request)) {
        nextResponse = patchSnapshotRunning(nextResponse, testState.preferredRoomMocks.runningProjectId);
      }
      if (testState?.reworkProgressMock && isSnapshotFetch(request)) {
        nextResponse = patchSnapshotReworkPending(nextResponse, testState.reworkProgressMock);
      }
      if (testState?.missingAgentInject && isSnapshotFetch(request)) {
        nextResponse = injectMissingAgentIntoSnapshot(nextResponse, testState.missingAgentInject);
      }
      return nextResponse;
    });
  }, STALE_OFFICE_SNAPSHOT_TITLE);
}

export async function armOfficeSnapshotStaleGate(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const state = (globalThis as unknown as {
      __clawxOfficeE2eTest?: {
        snapshotGate: { release: () => void; promise: Promise<void> } | null;
        staleApplied: boolean;
      };
    }).__clawxOfficeE2eTest;
    if (!state) throw new Error('installOfficeCacheTestHooks must run first');
    let release: () => void = () => {};
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.snapshotGate = { release, promise };
    state.staleApplied = false;
  });
}

export async function releaseOfficeSnapshotStaleGate(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as unknown as {
      __clawxOfficeE2eTest?: { snapshotGate?: { release: () => void } | null };
    }).__clawxOfficeE2eTest?.snapshotGate?.release();
  });
}

export async function armOfficeMissingAgentInjection(
  app: ElectronApplication,
  payload: {
    groupNameIncludes?: string;
    projectTitleIncludes?: string;
    ghostId?: string;
    markArchived?: boolean;
  },
): Promise<void> {
  await app.evaluate((next) => {
    const state = (globalThis as unknown as {
      __clawxOfficeE2eTest?: {
        missingAgentInject: {
          groupNameIncludes?: string;
          projectTitleIncludes?: string;
          ghostId: string;
          markArchived?: boolean;
        } | null;
      };
    }).__clawxOfficeE2eTest;
    if (!state) throw new Error('installOfficeCacheTestHooks must run first');
    state.missingAgentInject = {
      groupNameIncludes: next.groupNameIncludes,
      projectTitleIncludes: next.projectTitleIncludes,
      ghostId: next.ghostId ?? 'e2e-deleted-agent',
      markArchived: next.markArchived,
    };
  }, payload);
}

export async function armPreferredRoomMocks(
  app: ElectronApplication,
  payload: {
    runningProjectId: string;
    idleProjectId: string;
    runningMarker: string;
    idleMarker: string;
  } | null,
): Promise<void> {
  await app.evaluate((next) => {
    const state = (globalThis as unknown as {
      __clawxOfficeE2eTest?: { preferredRoomMocks: typeof next };
    }).__clawxOfficeE2eTest;
    if (!state) throw new Error('installOfficeCacheTestHooks must run first');
    state.preferredRoomMocks = next;
  }, payload);
}

export async function armOfficeReworkProgressRoomMock(
  app: ElectronApplication,
  payload: {
    projectId: string;
    agentId: string;
    nodeId?: string;
    progressText?: string;
    content?: string;
  },
): Promise<void> {
  await app.evaluate((next) => {
    const state = (globalThis as unknown as {
      __clawxOfficeE2eTest?: {
        reworkProgressMock: {
          projectId: string;
          agentId: string;
          nodeId: string;
          progressText: string;
          content: string;
        } | null;
      };
    }).__clawxOfficeE2eTest;
    if (!state) throw new Error('installOfficeCacheTestHooks must run first');
    state.reworkProgressMock = {
      projectId: next.projectId,
      agentId: next.agentId,
      nodeId: next.nodeId ?? 'gen-6',
      progressText: next.progressText ?? '已回流上游，等待重做',
      content: next.content ?? '🤖 【软件测试】⚙️ 执行中 · 功能测试',
    };
  }, payload);
}

export async function readOfficeProjectIdByTitle(page: Page, title: string): Promise<string> {
  const card = page.locator('[data-testid^="office-task-card-"]').filter({ hasText: title });
  await expect(card).toBeVisible();
  const testId = await card.getAttribute('data-testid');
  if (!testId?.startsWith('office-task-card-')) {
    throw new Error(`office task card test id not found for ${title}`);
  }
  return testId.slice('office-task-card-'.length);
}

export async function enableOfficeCollaboration(userDataDir: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await writeFile(
    join(userDataDir, 'settings.json'),
    `${JSON.stringify({ language: 'en' }, null, 2)}\n`,
    'utf8',
  );
}

export async function installGatewayReadyForOffice(app: ElectronApplication): Promise<void> {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', port: 18789, gatewayReady: true },
  });
  await installOfficeCacheTestHooks(app);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('gateway:status-changed', {
      state: 'running',
      port: 18789,
      gatewayReady: true,
      pid: 4242,
      connectedAt: Date.now(),
    });
  });
}

export async function createStandaloneProject(page: Page, title: string): Promise<void> {
  await page.getByTestId('office-new-temp-project').click();
  const dialog = page.getByTestId('office-task-create-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('office-task-create-origin-standalone').check();
  await dialog.getByTestId('office-task-create-origin-continue').click();
  await dialog.getByTestId('office-task-create-title').fill(title);
  await dialog.getByTestId('office-task-create-feature-description').fill(`${title} feature`);
  const availableAgent = dialog.locator('[data-testid^="office-agent-pool-"][data-bound="false"]').first();
  await expect(availableAgent).toBeVisible();
  await availableAgent.click();
  await dialog.getByTestId('office-task-create-submit').click();
  await expect(dialog).toHaveCount(0);
}

export async function waitForOfficeCacheIdle(page: Page): Promise<void> {
  await expect(page.getByTestId('office-sync-loading')).toHaveCount(0);
  await expect
    .poll(async () => page.getByTestId('office-refresh').isDisabled())
    .toBe(false);
}
