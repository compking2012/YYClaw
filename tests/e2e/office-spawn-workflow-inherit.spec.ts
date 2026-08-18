import type { Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';
import {
  enableOfficeCollaboration,
  installGatewayReadyForOffice,
  readOfficeProjectIdByTitle,
  waitForOfficeCacheIdle,
} from './office-cache';

async function seedOpenClawAgent(homeDir: string, agentId: string): Promise<void> {
  const openclawDir = join(homeDir, '.openclaw');
  await mkdir(join(openclawDir, 'agents', agentId, 'agent'), { recursive: true });
  await writeFile(
    join(openclawDir, 'openclaw.json'),
    `${JSON.stringify({
      agents: {
        list: [{ id: agentId, name: agentId }],
      },
    }, null, 2)}\n`,
    'utf8',
  );
}

async function hostOfficeFetch<T>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  return page.evaluate(
    async ({ path: apiPath, method, body }) => {
      const clawx = (window as unknown as {
        clawx?: {
          hostInvoke: (request: {
            id: string;
            module: string;
            action: string;
            payload?: unknown;
          }) => Promise<{
            ok?: boolean;
            error?: { message?: string };
            data?: { status?: number; body?: unknown };
          }>;
        };
      }).clawx;
      if (!clawx?.hostInvoke) {
        throw new Error('window.clawx.hostInvoke unavailable');
      }
      const response = await clawx.hostInvoke({
        id: crypto.randomUUID(),
        module: 'legacy',
        action: 'fetch',
        payload: {
          path: apiPath,
          method: method ?? 'GET',
          headers: body ? { 'Content-Type': 'application/json' } : {},
          body: body ? JSON.stringify(body) : undefined,
        },
      });
      if (!response.ok) {
        throw new Error(response.error?.message || `Host invoke failed for ${apiPath}`);
      }
      const status = response.data?.status ?? 0;
      if (status < 200 || status >= 300) {
        const errBody = response.data?.body;
        const detail = typeof errBody === 'object' && errBody && 'error' in errBody
          ? String((errBody as { error: unknown }).error)
          : JSON.stringify(errBody);
        throw new Error(`Host API ${method ?? 'GET'} ${apiPath} failed: ${status} ${detail}`);
      }
      return response.data?.body as T;
    },
    { path, method: init?.method, body: init?.body },
  );
}

async function firstUnboundAgentId(page: Page): Promise<string> {
  await page.getByTestId('office-new-group').click();
  const wizard = page.getByTestId('office-group-form');
  await expect(wizard).toBeVisible();
  const availableAgent = wizard.locator('[data-testid^="office-agent-pool-"][data-bound="false"]').first();
  await expect(availableAgent).toBeVisible();
  const agentTestId = await availableAgent.getAttribute('data-testid');
  expect(agentTestId).toBeTruthy();
  const agentId = agentTestId!.replace(/^office-agent-pool-/, '');
  // Close without edits so unsaved-draft guard does not block.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('office-group-form')).toHaveCount(0);
  return agentId;
}

test.describe('Office spawned workflow inherit', () => {
  test('untouched spawn inherits group workflow; group node delete follows', async ({
    launchElectronApp,
    userDataDir,
    homeDir,
  }) => {
    await enableOfficeCollaboration(userDataDir);
    await seedOpenClawAgent(homeDir, 'main');
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await installGatewayReadyForOffice(app);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-page')).toBeVisible();
      await waitForOfficeCacheIdle(page);

      const stamp = Date.now();
      const groupName = `InheritGroup-${stamp}`;
      const projectTitle = `InheritProject-${stamp}`;
      const agentId = await firstUnboundAgentId(page);

      const twoNodeWorkflow = {
        mode: 'dag' as const,
        nodes: [
          { id: 'gen-0', title: '计划', agentIds: [agentId] },
          { id: 'gen-1', title: '总结', agentIds: [agentId] },
        ],
        edges: [{ from: 'gen-0', to: 'gen-1' }],
      };
      const created = await hostOfficeFetch<{ success: boolean; group: {
        id: string;
        name: string;
        agentIds: string[];
        coordinatorAgentId: string;
      } }>(page, '/api/office/groups', {
        method: 'POST',
        body: {
          name: groupName,
          agentIds: [agentId],
          coordinatorAgentId: agentId,
          executionMode: 'workflow',
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: 'Step one plan then step two summarize',
          workflow: twoNodeWorkflow,
        },
      });
      const group = created.group;
      expect(group?.id).toBeTruthy();

      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      // Spawn from group without customizing workflow (API mirrors untouched create).
      const spawned = await hostOfficeFetch<{ success: boolean; project: {
        id: string;
        title: string;
        inheritsGroupTemplate?: boolean;
        workflow?: { nodes: unknown[] };
        parentGroupId?: string;
      } }>(page, `/api/office/groups/${encodeURIComponent(group.id)}/spawn-project`, {
        method: 'POST',
        body: {
          title: projectTitle,
          featureDescription: `${projectTitle} feature`,
          description: 'Step one plan then step two summarize',
          workflowOrchestrationMode: 'heuristic',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          agentIds: group.agentIds,
          coordinatorAgentId: group.coordinatorAgentId,
          executionMode: 'workflow',
        },
      });
      expect(spawned.project.inheritsGroupTemplate).toBe(true);
      expect(spawned.project.workflow?.nodes ?? []).toEqual([]);
      expect(spawned.project.parentGroupId).toBe(group.id);

      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);
      const projectId = await readOfficeProjectIdByTitle(page, projectTitle);
      expect(projectId).toBe(spawned.project.id);

      // Delete one node on the fixed group — no-own project must follow.
      const oneNodeWorkflow = {
        mode: 'dag' as const,
        nodes: [{ id: 'gen-0', title: '计划', agentIds: group.agentIds.slice(0, 1) }],
        edges: [] as Array<{ from: string; to: string }>,
      };
      await hostOfficeFetch(page, `/api/office/groups/${encodeURIComponent(group.id)}`, {
        method: 'PUT',
        body: {
          name: groupName,
          agentIds: group.agentIds,
          coordinatorAgentId: group.coordinatorAgentId,
          executionMode: 'workflow',
          workflowOrchestrationMode: 'heuristic',
          workflowDescription: 'Step one plan then step two summarize',
          workflow: oneNodeWorkflow,
        },
      });

      const snapshot = await hostOfficeFetch<{
        success: boolean;
        tempProjects: Array<{
          id: string;
          inheritsGroupTemplate?: boolean;
          workflow?: { nodes: unknown[] };
        }>;
        fixedGroups: Array<{ id: string; workflow?: { nodes: unknown[] } }>;
      }>(page, '/api/office/snapshot');
      const liveGroup = snapshot.fixedGroups.find((g) => g.id === group.id);
      expect(liveGroup?.workflow?.nodes).toHaveLength(1);
      const liveProject = snapshot.tempProjects.find((p) => p.id === projectId);
      expect(liveProject?.inheritsGroupTemplate).toBe(true);
      expect(liveProject?.workflow?.nodes ?? []).toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
