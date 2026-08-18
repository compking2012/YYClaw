import type { IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'node:fs/promises';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import {
  getSnapshot,
  listFixedGroups,
  upsertFixedGroup,
  archiveTempProject,
  restartArchivedTempProject,
  deleteFixedGroup,
  reorderFixedGroups,
  listTempProjects,
  upsertTempProject,
  insertStandaloneTempProject,
  spawnProjectFromGroup,
  upgradeTempProjectToGroup,
  markTempProjectUpgraded,
  dissolveTempProject,
  deleteTempProject,
  deleteArchivedTempProject,
  prepareTempProjectForRun,
  createFixedGroupDraft,
  updateSettings,
  loadStore,
  saveStore,
  getTempProject,
  getProjectProgress,
  dismissCompletionFollowUp,
} from '../../services/office/store';
import { ensureAgentToAgentConfig } from '../../services/office/agent-setup';
import { noteConfigWatcherRefresh } from '../../gateway/config-refresh-scheduler';
import { readAgentIdsFromOpenClawConfig } from '../../utils/agent-config';
import { OfficeOpenClawWriteFrozenError } from '../../services/office/office-openclaw-guard';
import { isAgentInPool, AgentBindingError, isTempProjectArchived, assertProjectEditableForPatch, assertProjectMemberPatch, assertOfficeEntityAgentsExist } from '../../services/office/agent-binding';
import { postRoomMessage, listRoomHistory } from '../../services/office/orchestrator';
import {
  runOfficeProject,
  abortOfficeTaskRun,
  ensureOfficeTaskGatewayLifecycleGuard,
} from '../../services/office/task-run';
import type {
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  LangGraphWorkflowBundle,
} from '../../services/office/types';
import { normalizeLangGraphWorkflowBundle, langGraphWorkflowDescriptionRequired } from '../../../src/lib/office-langgraph-workflow-bundle';
import { isFixedGroupSpawnedProject, spawnedProjectOrchestrationModeLocked } from '../../../src/lib/office-fixed-group';
import { orchestrationModeFromGroup } from '../../../src/lib/office-workflow-orchestration-mode';
import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';
import {
  fixedGroupContextForProjectRecord,
  isWorkflowDescriptionSatisfied,
  workflowForProject,
  workflowsStructurallyEqual,
} from '../../../src/lib/office-task-workflow';
import { syncWorkflowEdges, validateWorkflowEdges } from '../../services/office/workflow-edges';
import { ensureCoordinatorInTeam } from '../../../src/lib/office-workflow-roles';
import { generateWorkflowFromDescription } from '../../services/office/workflow-generate';
import { ENABLE_LANGGRAPH, resolveWorkflowEngineInput } from '../../../src/lib/feature-langgraph';
import { taskWorkflowEngine } from '../../../src/lib/office-workflow-engine';
import { getOfficeDataPath } from '../../services/office/paths';
import { listOpenclawSkills } from '../../utils/openclaw-skills';
import { taskExecutionMode } from '../../services/office/task-execution-mode';
import { validateTaskRunRequest } from '../../services/office/task-run-request';
import { isOfficeCollaborationEnabled } from '@shared/office-collaboration-feature';
import { hasWorkflowStepDraftContent } from '../../../src/lib/office-workflow-step-drafts';

function officeApiError(res: ServerResponse, status: number, error: string, errors?: string[]): void {
  sendJson(res, status, { success: false, error, errors });
}

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  noteConfigWatcherRefresh(ctx.gatewayManager, `Office config changed (${reason})`, {
    onlyIfRunning: true,
  });
}

/** Map legacy `/scenarios` and `/tasks` paths to v2 `/groups` and `/projects`. */
function officeResourcePath(pathname: string, base: string): string {
  const suffix = pathname.slice(base.length);
  if (suffix.startsWith('/scenarios')) {
    return suffix.replace(/^\/scenarios/, '/groups');
  }
  if (suffix.startsWith('/tasks')) {
    return suffix.replace(/^\/tasks/, '/projects');
  }
  return suffix;
}

function workflowValidationError(workflow: WorkflowDefinition | undefined): string | null {
  if (!workflow) return null;
  const result = validateWorkflowEdges(workflow);
  return result.valid ? null : result.i18nKey;
}

function bindingErrorStatus(code: AgentBindingError['code']): number {
  switch (code) {
    case 'AGENT_ALREADY_BOUND':
    case 'GROUP_HAS_ACTIVE_CHILD_PROJECT':
    case 'GROUP_SPAWN_LIMIT':
    case 'PROJECT_ARCHIVED':
      return 409;
    default:
      return 400;
  }
}

function sendOfficeOpenClawWriteFrozenError(res: ServerResponse, e: OfficeOpenClawWriteFrozenError): void {
  officeApiError(res, 409, e.message, [e.code]);
}

function sendOfficeStoreMutationError(res: ServerResponse, e: unknown): boolean {
  if (e instanceof AgentBindingError) {
    sendBindingError(res, e);
    return true;
  }
  if (e instanceof OfficeOpenClawWriteFrozenError) {
    sendOfficeOpenClawWriteFrozenError(res, e);
    return true;
  }
  return false;
}

function sendBindingError(res: ServerResponse, e: AgentBindingError): void {
  officeApiError(res, bindingErrorStatus(e.code), e.message, [e.code]);
}

function fixedGroupContextForProject(
  project: OfficeTempProject,
  groups: OfficeFixedGroup[],
): OfficeFixedGroup {
  return fixedGroupContextForProjectRecord(project, groups);
}

export async function handleOfficeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  const base = '/api/office';
  if (!url.pathname.startsWith(base)) {
    return false;
  }

  if (!isOfficeCollaborationEnabled()) {
    officeApiError(res, 403, 'Office collaboration is disabled in this build');
    return true;
  }
  ensureOfficeTaskGatewayLifecycleGuard(ctx.gatewayManager);

  const path = officeResourcePath(url.pathname, base);

  if (path === '/execution-sync/status' && req.method === 'GET') {
    const { isOfficeExecutionSyncActiveForPolling } = await import('../../services/office/office-sync-runtime');
    sendJson(res, 200, {
      success: true,
      active: await isOfficeExecutionSyncActiveForPolling(),
    });
    return true;
  }

  if (path === '/snapshot' && req.method === 'GET') {
    sendJson(res, 200, { success: true, ...(await getSnapshot()) });
    return true;
  }

  if (path === '/skills-catalog' && req.method === 'GET') {
    try {
      const { skills } = await listOpenclawSkills();
      sendJson(res, 200, {
        success: true,
        skills: skills.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji })),
      });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/agents/pool' && req.method === 'GET') {
    try {
      const [knownAgentIds, officeSnapshot] = await Promise.all([
        readAgentIdsFromOpenClawConfig(),
        getSnapshot(),
      ]);
      const agentIds = [...knownAgentIds].filter((id) => isAgentInPool(id, officeSnapshot));
      sendJson(res, 200, { success: true, agentIds });
    } catch (e) {
      officeApiError(res, 500, e instanceof Error ? e.message : String(e));
    }
    return true;
  }

  if (path === '/settings' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ agentToAgentEnabled?: boolean; agentToAgentAllow?: string[] }>(req);
      const settings = await updateSettings({
        ...(body.agentToAgentEnabled !== undefined ? { agentToAgentEnabled: body.agentToAgentEnabled } : {}),
        ...(body.agentToAgentAllow ? { agentToAgentAllow: body.agentToAgentAllow } : {}),
      });
      if (settings.agentToAgentEnabled && settings.agentToAgentAllow.length > 0) {
        await ensureAgentToAgentConfig(settings.agentToAgentAllow);
      }
      scheduleGatewayReload(ctx, 'office-agent-to-agent');
      sendJson(res, 200, { success: true, settings });
    } catch (e) {
      if (e instanceof OfficeOpenClawWriteFrozenError) {
        sendOfficeOpenClawWriteFrozenError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/settings/enable-collab' && req.method === 'POST') {
    try {
      const snapshot = await getSnapshot();
      const agentIdSet = new Set<string>();
      for (const group of snapshot.fixedGroups) {
        for (const agentId of group.agentIds) agentIdSet.add(agentId);
      }
      for (const project of snapshot.tempProjects) {
        if (project.lifecycle !== 'active') continue;
        for (const agentId of project.agentIds) agentIdSet.add(agentId);
      }
      const agentIds = [...agentIdSet];
      await ensureAgentToAgentConfig(agentIds);
      const settings = await updateSettings({ agentToAgentEnabled: true, agentToAgentAllow: agentIds });
      scheduleGatewayReload(ctx, 'enable-collab');
      sendJson(res, 200, { success: true, settings });
    } catch (e) {
      if (e instanceof OfficeOpenClawWriteFrozenError) {
        sendOfficeOpenClawWriteFrozenError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/groups' && req.method === 'GET') {
    sendJson(res, 200, { success: true, groups: await listFixedGroups() });
    return true;
  }

  if (path === '/groups/reorder' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ orderedIds: string[] }>(req);
      if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
        sendJson(res, 400, { success: false, error: 'orderedIds required' });
        return true;
      }
      const groups = await reorderFixedGroups(body.orderedIds);
      sendJson(res, 200, { success: true, groups });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/groups' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        name: string;
        description?: string;
        agentIds: string[];
        coordinatorAgentId: string;
        executionMode?: import('../../../src/types/office').OfficeFixedGroup['executionMode'];
        workflow?: WorkflowDefinition;
        workflowDescription?: string;
        workflowStepDrafts?: import('../../../src/types/office').WorkflowStepDraftRow[];
        workflowOrchestrationMode?: import('../../../src/types/office').WorkflowOrchestrationMode;
        upgradeFromProjectId?: string;
      }>(req);
      const edgeError = workflowValidationError(body.workflow);
      if (edgeError) {
        sendJson(res, 400, { success: false, error: edgeError });
        return true;
      }
      if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
        sendJson(res, 400, { success: false, error: 'groupForm.agentsRequired' });
        return true;
      }
      const coordinatorAgentId = ensureCoordinatorInTeam(
        body.coordinatorAgentId,
        body.agentIds,
        body.agentIds[0],
      );
      let group = createFixedGroupDraft({
        name: body.name,
        description: body.description,
        agentIds: body.agentIds,
        coordinatorAgentId,
        executionMode: body.executionMode,
        workflow: body.workflow,
        workflowDescription: body.workflowDescription,
        workflowStepDrafts: body.workflowStepDrafts,
        workflowOrchestrationMode: body.workflowOrchestrationMode,
      });
      group = await upsertFixedGroup(group, {
        upgradeFromProjectId: body.upgradeFromProjectId,
      });
      sendJson(res, 200, { success: true, group });
    } catch (e) {
      if (sendOfficeStoreMutationError(res, e)) return true;
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/groups\/[^/]+$/) && req.method === 'PUT') {
    try {
      const groupId = decodeURIComponent(path.slice('/groups/'.length));
      const body = await parseJsonBody<Partial<OfficeFixedGroup>>(req);
      const groups = await listFixedGroups();
      const existing = groups.find((g) => g.id === groupId);
      if (!existing) {
        sendJson(res, 404, { success: false, error: 'Group not found' });
        return true;
      }
      const agentIds = body.agentIds ?? existing.agentIds;
      const mergedWorkflow = body.workflow ?? existing.workflow;
      const edgeError = workflowValidationError(mergedWorkflow);
      if (edgeError) {
        sendJson(res, 400, { success: false, error: edgeError });
        return true;
      }
      if (
        typeof body.coordinatorAgentId === 'string'
        && !body.coordinatorAgentId.trim()
        && agentIds.length > 0
      ) {
        sendJson(res, 400, { success: false, error: 'taskForm.coordinatorRequired' });
        return true;
      }
      const coordinatorAgentId = ensureCoordinatorInTeam(
        body.coordinatorAgentId ?? existing.coordinatorAgentId,
        agentIds,
        agentIds[0] ?? existing.coordinatorAgentId,
      );
      const group = await upsertFixedGroup({
        ...existing,
        ...body,
        id: existing.id,
        agentIds,
        coordinatorAgentId,
        executionMode: existing.executionMode ?? 'workflow',
        workflow: mergedWorkflow,
      });
      sendJson(res, 200, { success: true, group });
    } catch (e) {
      if (sendOfficeStoreMutationError(res, e)) return true;
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/groups\/[^/]+$/) && req.method === 'DELETE') {
    try {
      const groupId = decodeURIComponent(path.slice('/groups/'.length));
      await deleteFixedGroup(groupId);
      sendJson(res, 200, { success: true });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/groups\/[^/]+\/spawn-project$/) && req.method === 'POST') {
    try {
      const groupId = decodeURIComponent(path.slice('/groups/'.length).replace('/spawn-project', ''));
      const body = await parseJsonBody<{
        title: string;
        agentIds?: string[];
        coordinatorAgentId?: string;
        featureDescription: string;
        description?: string;
        workflowStepDrafts?: import('../../../src/types/office').WorkflowStepDraftRow[];
        workflowOrchestrationMode?: import('../../../src/types/office').WorkflowOrchestrationMode;
        executionMode?: 'workflow' | 'smart';
        workflowEngine?: 'dag' | 'langgraph';
        workflow?: WorkflowDefinition;
        langGraphWorkflowBundle?: LangGraphWorkflowBundle;
      }>(req);
      const featureDescription = body.featureDescription?.trim() ?? '';
      if (!featureDescription) {
        sendJson(res, 400, { success: false, error: 'taskForm.featureDescriptionRequired' });
        return true;
      }
      const executionMode = body.executionMode === 'smart' ? 'smart' : 'workflow';
      const workflowEngine = resolveWorkflowEngineInput(executionMode, body.workflowEngine);
      let workflow = body.workflow
        ? workflowEngine === 'langgraph'
          ? {
            ...body.workflow,
            mode: 'dag' as const,
            orchestrationEngine: 'langgraph' as const,
            edgesCustomized: true,
          }
          : syncWorkflowEdges({ ...body.workflow, mode: 'dag' })
        : { mode: 'dag' as const, nodes: [], edges: [] };
      if (executionMode === 'workflow') {
        const edgeError = workflowValidationError(workflow);
        if (edgeError) {
          sendJson(res, 400, { success: false, error: edgeError });
          return true;
        }
      } else {
        workflow = { mode: 'dag', nodes: [], edges: [] };
      }
      const description = (body.description ?? '').trim();
      const langGraphBundle =
        workflowEngine === 'langgraph'
          ? normalizeLangGraphWorkflowBundle(body.langGraphWorkflowBundle)
          : undefined;
      // Spawn inherits group.workflowDescription when description is omitted — do not require here.
      const project = await spawnProjectFromGroup({
        groupId,
        title: body.title.trim(),
        agentIds: body.agentIds,
        coordinatorAgentId: body.coordinatorAgentId,
        featureDescription,
        description,
        workflowStepDrafts: body.workflowStepDrafts,
        workflowOrchestrationMode: body.workflowOrchestrationMode,
        executionMode,
        workflowEngine,
        workflow: executionMode === 'workflow' ? workflow : undefined,
        langGraphWorkflowBundle:
          executionMode === 'workflow' && workflowEngine === 'langgraph'
            ? langGraphBundle
            : undefined,
      });
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/workflows/generate' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        description: string;
        featureDescription?: string;
        workflowStepDrafts?: import('../../../src/types/office').WorkflowStepDraftRow[];
        agentIds: string[];
        coordinatorAgentId?: string;
        taskTitle?: string;
        strategy?: 'auto' | 'heuristic' | 'ai' | 'gateway-first' | 'gateway-then-direct';
        workflowEngine?: 'dag' | 'langgraph';
      }>(req);
      const desc = body.description?.trim() ?? '';
      const feature = body.featureDescription?.trim() ?? '';
      const hasDrafts = hasWorkflowStepDraftContent(body.workflowStepDrafts);
      if (!desc && !feature && !hasDrafts) {
        sendJson(res, 400, { success: false, error: 'workflow.generateNeedDescription' });
        return true;
      }
      if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
        sendJson(res, 400, { success: false, error: 'workflow.generateNeedAgents' });
        return true;
      }
      const gw = ctx.gatewayManager.getStatus();
      const gateway =
        gw.state === 'running' && ctx.gatewayManager.isConnected() ? ctx.gatewayManager : null;
      const result = await generateWorkflowFromDescription(
        gateway,
        {
          description: desc || feature,
          workflowStepDrafts: hasDrafts ? body.workflowStepDrafts : undefined,
          agentIds: body.agentIds,
          coordinatorAgentId: body.coordinatorAgentId,
          taskTitle: body.taskTitle,
          strategy: body.strategy ?? 'auto',
          workflowEngine: resolveWorkflowEngineInput('workflow', body.workflowEngine),
        } as unknown as Parameters<typeof generateWorkflowFromDescription>[1],
      );
      if (!result) {
        sendJson(res, 422, { success: false, error: 'workflow.generateFailed' });
        return true;
      }
      sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/projects' && req.method === 'GET') {
    const parentGroupId = url.searchParams.get('parentGroupId') ?? undefined;
    const standaloneOnly = url.searchParams.get('standaloneOnly') === '1';
    const projects = await listTempProjects({
      ...(parentGroupId ? { parentGroupId } : {}),
      ...(standaloneOnly ? { standaloneOnly: true } : {}),
    });
    sendJson(res, 200, { success: true, projects });
    return true;
  }

  if (path === '/projects' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        title: string;
        agentIds: string[];
        coordinatorAgentId?: string;
        featureDescription?: string;
        description?: string;
        workflowStepDrafts?: import('../../../src/types/office').WorkflowStepDraftRow[];
        executionMode?: 'workflow' | 'smart';
        workflowEngine?: 'dag' | 'langgraph';
        workflow?: WorkflowDefinition;
        langGraphWorkflowBundle?: LangGraphWorkflowBundle;
      }>(req);
      if (!Array.isArray(body.agentIds) || body.agentIds.length === 0) {
        sendJson(res, 400, { success: false, error: 'taskForm.agentsRequired' });
        return true;
      }
      const executionMode = body.executionMode === 'smart' ? 'smart' : 'workflow';
      const workflowEngine = resolveWorkflowEngineInput(executionMode, body.workflowEngine);
      let workflow = body.workflow
        ? workflowEngine === 'langgraph'
          ? {
            ...body.workflow,
            mode: 'dag' as const,
            orchestrationEngine: 'langgraph' as const,
            edgesCustomized: true,
          }
          : syncWorkflowEdges({ ...body.workflow, mode: 'dag' })
        : { mode: 'dag' as const, nodes: [], edges: [] };
      if (executionMode === 'workflow') {
        const edgeError = workflowValidationError(workflow);
        if (edgeError) {
          sendJson(res, 400, { success: false, error: edgeError });
          return true;
        }
        if (workflow.nodes.length > 0 && workflow.nodes.some((n) => !n.title?.trim())) {
          sendJson(res, 400, { success: false, error: 'workflow.validationNeedTaskNames' });
          return true;
        }
      } else {
        workflow = { mode: 'dag', nodes: [], edges: [] };
      }
      const featureDescription = (body.featureDescription ?? '').trim();
      if (!featureDescription) {
        sendJson(res, 400, { success: false, error: 'taskForm.featureDescriptionRequired' });
        return true;
      }
      const description = (body.description ?? '').trim();
      const hasWorkflowDrafts = hasWorkflowStepDraftContent(body.workflowStepDrafts);
      const langGraphBundle =
        workflowEngine === 'langgraph'
          ? normalizeLangGraphWorkflowBundle(body.langGraphWorkflowBundle)
          : undefined;
      if (
        executionMode === 'workflow'
        && langGraphWorkflowDescriptionRequired(
          workflowEngine,
          langGraphBundle?.activeSource ?? 'heuristic',
        )
        && !description
        && !hasWorkflowDrafts
      ) {
        sendJson(res, 400, { success: false, error: 'taskForm.descriptionRequired' });
        return true;
      }
      const coordinatorAgentId = ensureCoordinatorInTeam(
        body.coordinatorAgentId?.trim() ?? '',
        body.agentIds,
        body.agentIds[0],
      );
      const project = await insertStandaloneTempProject({
        title: body.title.trim(),
        agentIds: body.agentIds,
        coordinatorAgentId,
        featureDescription,
        description,
        workflowStepDrafts: body.workflowStepDrafts,
        executionMode,
        workflowEngine,
        workflow: executionMode === 'workflow' ? workflow : undefined,
        langGraphWorkflowBundle:
          executionMode === 'workflow' && workflowEngine === 'langgraph'
            ? langGraphBundle
            : undefined,
      });
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (sendOfficeStoreMutationError(res, e)) return true;
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+$/) && req.method === 'PATCH') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length));
      const body = await parseJsonBody<{
        title?: string;
        featureDescription?: string;
        description?: string;
        workflowStepDrafts?: import('../../../src/types/office').WorkflowStepDraftRow[];
        workflowOrchestrationMode?: import('../../../src/types/office').WorkflowOrchestrationMode;
        coordinatorAgentId?: string;
        agentIds?: string[];
        executionMode?: 'workflow' | 'smart';
        workflowEngine?: 'dag' | 'langgraph';
        workflow?: WorkflowDefinition;
        langGraphWorkflowBundle?: LangGraphWorkflowBundle;
        inheritsGroupTemplate?: boolean;
        workflowFreezeSnapshot?: OfficeTempProject['workflowFreezeSnapshot'] | null;
      }>(req);
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可编辑`),
        );
        return true;
      }
      try {
        assertProjectEditableForPatch(project);
      } catch (e) {
        if (e instanceof AgentBindingError) {
          sendBindingError(res, e);
          return true;
        }
        throw e;
      }
      const groups = await listFixedGroups();
      const parentGroup = project.parentGroupId
        ? groups.find((g) => g.id === project.parentGroupId)
        : undefined;
      const workflowBefore = workflowForProject(project, parentGroup);
      const teamAgentIds = body.agentIds ?? project.agentIds;
      const spawnedFromFixedGroup = isFixedGroupSpawnedProject(project, parentGroup);

      if (Array.isArray(body.agentIds) && body.agentIds.length > 0) {
        try {
          const store = await loadStore();
          assertProjectMemberPatch(project, body.agentIds, store, parentGroup);
        } catch (e) {
          if (e instanceof AgentBindingError) {
            sendBindingError(res, e);
            return true;
          }
          throw e;
        }
      }

      if (typeof body.title === 'string' && body.title.trim()) project.title = body.title.trim();
      if (typeof body.featureDescription === 'string') {
        const fd = body.featureDescription.trim();
        if (!fd) {
          sendJson(res, 400, { success: false, error: 'taskForm.featureDescriptionRequired' });
          return true;
        }
        project.featureDescription = fd;
      }
      if (typeof body.description === 'string') project.description = body.description.trim();
      // Ownership flag first (sticky): never re-inherit once owned.
      if (typeof body.inheritsGroupTemplate === 'boolean') {
        const { projectOwnsWorkflow } = await import('../../../src/lib/office-spawned-workflow-ownership');
        if (projectOwnsWorkflow(project) && body.inheritsGroupTemplate === true) {
          project.inheritsGroupTemplate = false;
        } else {
          project.inheritsGroupTemplate = body.inheritsGroupTemplate;
        }
      }
      if (body.workflowFreezeSnapshot === null) {
        project.workflowFreezeSnapshot = undefined;
      } else if (body.workflowFreezeSnapshot !== undefined) {
        project.workflowFreezeSnapshot = body.workflowFreezeSnapshot;
      }
      if (project.inheritsGroupTemplate === false) {
        project.workflowFreezeSnapshot = undefined;
      }
      if (body.workflowStepDrafts !== undefined) {
        if (project.inheritsGroupTemplate) {
          project.workflowStepDrafts = undefined;
        } else {
          project.workflowStepDrafts = hasWorkflowStepDraftContent(body.workflowStepDrafts)
            ? body.workflowStepDrafts
            : undefined;
        }
      }
      if (
        parentGroup
        && spawnedFromFixedGroup
        && !project.inheritsGroupTemplate
        && spawnedProjectOrchestrationModeLocked(parentGroup)
      ) {
        project.workflowOrchestrationMode = orchestrationModeFromGroup(parentGroup);
      } else if (body.workflowOrchestrationMode !== undefined) {
        if (project.inheritsGroupTemplate) {
          project.workflowOrchestrationMode = undefined;
        } else if (
          body.workflowOrchestrationMode === 'rule'
          || body.workflowOrchestrationMode === 'heuristic'
        ) {
          project.workflowOrchestrationMode = body.workflowOrchestrationMode;
        }
      }
      if (Array.isArray(body.agentIds) && body.agentIds.length > 0) {
        project.agentIds = body.agentIds;
      }
      if (typeof body.coordinatorAgentId === 'string') {
        const cid = body.coordinatorAgentId.trim();
        if (!cid) {
          // Explicit clear from the edit form — reject rather than silently
          // ensureCoordinatorInTeam back to agentIds[0].
          if (teamAgentIds.length > 0) {
            sendJson(res, 400, { success: false, error: 'taskForm.coordinatorRequired' });
            return true;
          }
          project.coordinatorAgentId = '';
        } else if (!teamAgentIds.includes(cid)) {
          sendJson(res, 400, { success: false, error: 'taskForm.coordinatorRequired' });
          return true;
        } else {
          project.coordinatorAgentId = cid;
        }
      } else {
        project.coordinatorAgentId = ensureCoordinatorInTeam(
          project.coordinatorAgentId,
          project.agentIds,
          parentGroup?.coordinatorAgentId ?? project.agentIds[0],
        );
      }
      if (!spawnedFromFixedGroup) {
        if (body.executionMode === 'smart' || body.executionMode === 'workflow') {
          project.executionMode = body.executionMode;
          if (body.executionMode === 'smart') {
            project.workflow = { mode: 'dag', nodes: [], edges: [] };
            project.workflowEngine = 'dag';
            project.langGraphWorkflowBundle = undefined;
            project.workflowStepDrafts = undefined;
          }
        }
        const mode = taskExecutionMode(project as Parameters<typeof taskExecutionMode>[0]);
        if (
          mode === 'workflow'
          && (body.workflowEngine === 'dag' || body.workflowEngine === 'langgraph')
        ) {
          project.workflowEngine = resolveWorkflowEngineInput('workflow', body.workflowEngine);
          if (project.workflowEngine === 'dag') {
            project.langGraphWorkflowBundle = undefined;
          }
        }
      }
      const mode = taskExecutionMode(project as Parameters<typeof taskExecutionMode>[0]);
      const patchHasWorkflowDrafts = hasWorkflowStepDraftContent(body.workflowStepDrafts);
      if (
        mode === 'workflow'
        && typeof body.description === 'string'
        && !body.description.trim()
        && !patchHasWorkflowDrafts
      ) {
        const bundleForValidation = ENABLE_LANGGRAPH
          ? normalizeLangGraphWorkflowBundle(
            body.langGraphWorkflowBundle ?? project.langGraphWorkflowBundle,
          )
          : undefined;
        const wfEngine = resolveWorkflowEngineInput(
          'workflow',
          body.workflowEngine ?? project.workflowEngine,
        );
        if (
          langGraphWorkflowDescriptionRequired(
            wfEngine,
            bundleForValidation?.activeSource ?? 'heuristic',
          )
          && !isWorkflowDescriptionSatisfied(
            project,
            parentGroup,
            body.description,
            body.workflowStepDrafts,
          )
        ) {
          sendJson(res, 400, { success: false, error: 'taskForm.descriptionRequired' });
          return true;
        }
      }
      if (body.workflow && mode === 'workflow') {
        const workflow =
          taskWorkflowEngine(project as Parameters<typeof taskWorkflowEngine>[0]) === 'langgraph'
            ? {
              ...body.workflow,
              mode: 'dag' as const,
              orchestrationEngine: 'langgraph' as const,
              edgesCustomized: true,
            }
            : syncWorkflowEdges({ ...body.workflow, mode: 'dag' });
        const edgeError = workflowValidationError(workflow);
        if (edgeError) {
          sendJson(res, 400, { success: false, error: edgeError });
          return true;
        }
        if (workflow.nodes.some((n) => !n.title?.trim())) {
          sendJson(res, 400, { success: false, error: 'workflow.validationNeedTaskNames' });
          return true;
        }
        if (project.inheritsGroupTemplate) {
          project.workflow = { mode: 'dag', nodes: [], edges: [] };
        } else {
          project.workflow = workflow;
        }
      }
      if (
        body.langGraphWorkflowBundle !== undefined
        && ENABLE_LANGGRAPH
        && project.workflowEngine === 'langgraph'
      ) {
        project.langGraphWorkflowBundle = normalizeLangGraphWorkflowBundle(body.langGraphWorkflowBundle);
      }
      const workflowAfter = workflowForProject(project, parentGroup);
      if (
        !isOfficeProjectExecuting(project)
        && !workflowsStructurallyEqual(workflowBefore, workflowAfter)
      ) {
        project.nodeRuns = [];
      }
      const updated = await upsertTempProject(project);
      sendJson(res, 200, { success: true, project: updated });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/run$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/run', ''));
      let body: {
        mode?: 'fresh' | 'continue' | 'single';
        nodeId?: string;
        clearProjectRoom?: boolean;
      } = {};
      try {
        const raw = await parseJsonBody<{
          mode?: 'fresh' | 'continue' | 'single';
          nodeId?: string;
          clearProjectRoom?: boolean;
        }>(req);
        body = raw ?? {};
      } catch {
        body = {};
      }
      const mode = body.mode ?? 'fresh';
      let project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      try {
        project = await prepareTempProjectForRun(projectId);
      } catch (e) {
        if (e instanceof AgentBindingError) {
          sendBindingError(res, e);
          return true;
        }
        throw e;
      }
      if (project.abortQuiescing) {
        sendJson(res, 409, { success: false, error: 'PROJECT_ABORT_QUIESCING' });
        return true;
      }
      if (project.status === 'running' && mode !== 'single') {
        sendJson(res, 409, { success: false, error: 'Project already running' });
        return true;
      }
      const groups = await listFixedGroups();
      const group = fixedGroupContextForProject(project, groups);
      const knownAgentIds = await readAgentIdsFromOpenClawConfig();
      try {
        const { resolveProjectAgentRefEntity } = await import('../../../src/lib/office-missing-agents');
        assertOfficeEntityAgentsExist(
          resolveProjectAgentRefEntity(project, group),
          knownAgentIds,
        );
      } catch (e) {
        if (e instanceof AgentBindingError) {
          sendBindingError(res, e);
          return true;
        }
        throw e;
      }
      const runValidation = validateTaskRunRequest(
        project as Parameters<typeof validateTaskRunRequest>[0],
        mode,
        body.nodeId,
        group,
      );
      if (runValidation) {
        sendJson(res, 400, { success: false, error: runValidation });
        return true;
      }
      const gw = ctx.gatewayManager.getStatus();
      if (gw.state !== 'running' || !ctx.gatewayManager.isConnected()) {
        sendJson(res, 503, { success: false, error: 'Gateway is not running' });
        return true;
      }
      void runOfficeProject(ctx.gatewayManager, project, group, {
        mode,
        nodeId: body.nodeId,
        clearProjectRoom: body.clearProjectRoom === true,
      }).catch((err) => {
        console.warn('[office] project run failed:', err);
      });
      sendJson(res, 200, { success: true, projectId, status: 'running', mode });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/unblock$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/unblock', ''));
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      if (project.executionMode === 'smart') {
        sendJson(res, 400, { success: false, error: 'taskRun.smartNoUnblock' });
        return true;
      }
      if (project.status !== 'blocked') {
        sendJson(res, 400, { success: false, error: 'taskRun.notBlocked' });
        return true;
      }
      const groups = await listFixedGroups();
      const group = fixedGroupContextForProject(project, groups);
      const gw = ctx.gatewayManager.getStatus();
      if (gw.state !== 'running' || !ctx.gatewayManager.isConnected()) {
        sendJson(res, 503, { success: false, error: 'Gateway is not running' });
        return true;
      }
      const { unblockWorkflowProject } = await import('../../services/office/workflow-unblock');
      const updated = await unblockWorkflowProject(ctx.gatewayManager, project, group);
      sendJson(res, 200, { success: true, project: updated });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/review\/status$/) && req.method === 'GET') {
    try {
      const projectId = decodeURIComponent(
        path.slice('/projects/'.length).replace('/review/status', ''),
      );
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      const { getWorkflowReviewStatus } = await import('../../services/office/workflow-review');
      sendJson(res, 200, { success: true, review: getWorkflowReviewStatus(project) });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/review\/submit$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(
        path.slice('/projects/'.length).replace('/review/submit', ''),
      );
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      const body = await parseJsonBody<{
        nodeId: string;
        decision: import('../../../src/types/office').WorkflowReviewAction;
        batchUpdatedAt: number;
      }>(req);
      if (!body.nodeId || !body.decision || !Number.isFinite(body.batchUpdatedAt)) {
        sendJson(res, 400, { success: false, error: 'nodeId, decision, and batchUpdatedAt required' });
        return true;
      }
      const groups = await listFixedGroups();
      const group = fixedGroupContextForProject(project, groups);
      const gw = ctx.gatewayManager;
      const gwStatus = gw.getStatus();
      if (gwStatus.state !== 'running' || !gw.isConnected()) {
        sendJson(res, 503, { success: false, error: 'Gateway is not running' });
        return true;
      }
      const { submitWorkflowReviewDecision } = await import('../../services/office/workflow-review');
      const result = await submitWorkflowReviewDecision(
        gw,
        project,
        group,
        body.nodeId,
        body.decision,
        body.batchUpdatedAt,
      );
      if (result.error) {
        const status = result.error === 'review_batch_stale' ? 409 : 400;
        sendJson(res, status, { success: false, error: result.error, project: result.project });
        return true;
      }
      sendJson(res, 200, {
        success: true,
        project: result.project,
        settled: result.settled === true,
      });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/review\/settle$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(
        path.slice('/projects/'.length).replace('/review/settle', ''),
      );
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      const body = await parseJsonBody<{ settleGeneration: number }>(req);
      if (!Number.isFinite(body.settleGeneration)) {
        sendJson(res, 400, { success: false, error: 'settleGeneration required' });
        return true;
      }
      const groups = await listFixedGroups();
      const group = fixedGroupContextForProject(project, groups);
      const gw = ctx.gatewayManager;
      const gwStatus = gw.getStatus();
      if (gwStatus.state !== 'running' || !gw.isConnected()) {
        sendJson(res, 503, { success: false, error: 'Gateway is not running' });
        return true;
      }
      const { settleWorkflowReviewBatch } = await import('../../services/office/workflow-review');
      const result = await settleWorkflowReviewBatch(
        gw,
        project,
        group,
        body.settleGeneration,
      );
      if (result.error) {
        const status = result.error === 'review_batch_stale' ? 409 : 400;
        sendJson(res, status, { success: false, error: result.error, project: result.project });
        return true;
      }
      sendJson(res, 200, { success: true, project: result.project });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/abort$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/abort', ''));
      const existing = await getTempProject(projectId);
      if (existing && isTempProjectArchived(existing)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${existing.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      const project = await abortOfficeTaskRun(projectId, { gateway: ctx.gatewayManager });
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/completion-follow-up\/dismiss$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(
        path.slice('/projects/'.length).replace('/completion-follow-up/dismiss', ''),
      );
      const project = await dismissCompletionFollowUp(projectId);
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/archive$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/archive', ''));
      console.info('[office] archive project requested:', projectId);
      const project = await archiveTempProject(projectId);
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/restart$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/restart', ''));
      console.info('[office] restart archived project requested:', projectId);
      const { project, agentSync } = await restartArchivedTempProject(projectId);
      sendJson(res, 200, { success: true, project, agentSync });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/delete-archived$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(
        path.slice('/projects/'.length).replace('/delete-archived', ''),
      );
      console.info('[office] delete archived project requested:', projectId);
      await deleteArchivedTempProject(projectId);
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/mark-upgraded$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/mark-upgraded', ''));
      const body = await parseJsonBody<{ groupId?: string }>(req);
      const groupId = body.groupId?.trim();
      if (!groupId) {
        sendJson(res, 400, { success: false, error: 'groupId required' });
        return true;
      }
      const project = await markTempProjectUpgraded(projectId, groupId);
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/upgrade$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/upgrade', ''));
      const result = await upgradeTempProjectToGroup(projectId);
      sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/dissolve$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/dissolve', ''));
      const project = await dissolveTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      sendJson(res, 200, { success: true, project });
    } catch (e) {
      if (e instanceof AgentBindingError) {
        sendBindingError(res, e);
        return true;
      }
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+$/) && req.method === 'DELETE') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length));
      const project = await getTempProject(projectId);
      if (project && isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      if (project?.status === 'running') {
        await abortOfficeTaskRun(projectId);
      }
      const parentGroupId = project?.parentGroupId;
      await deleteTempProject(projectId);
      sendJson(res, 200, { success: true, parentGroupId });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/progress$/) && req.method === 'GET') {
    const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/progress', ''));
    const progress = await getProjectProgress(projectId);
    if (!progress) {
      sendJson(res, 404, { success: false, error: 'Project not found' });
      return true;
    }
    sendJson(res, 200, { success: true, progress });
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/room\/messages$/) && req.method === 'GET') {
    const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/room/messages', ''));
    const urgent = url.searchParams.get('urgent') === '1';
    sendJson(res, 200, {
      success: true,
      messages: await listRoomHistory(projectId, { urgent }),
    });
    return true;
  }

  if (path.match(/^\/projects\/[^/]+\/room\/messages$/) && req.method === 'POST') {
    try {
      const projectId = decodeURIComponent(path.slice('/projects/'.length).replace('/room/messages', ''));
      const body = await parseJsonBody<{
        content: string;
        fromAgentId?: string;
        replyToId?: string;
      }>(req);
      const project = await getTempProject(projectId);
      if (!project) {
        sendJson(res, 404, { success: false, error: 'Project not found' });
        return true;
      }
      if (isTempProjectArchived(project)) {
        sendBindingError(
          res,
          new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`),
        );
        return true;
      }
      const groups = await listFixedGroups();
      const group = fixedGroupContextForProject(project, groups);
      const result = await postRoomMessage(ctx.gatewayManager, {
        projectId: project.id,
        coordinatorAgentId: project.coordinatorAgentId,
        content: body.content,
        groupId: group.id !== project.id ? group.id : project.parentGroupId,
        replyToId: body.replyToId,
      });
      sendJson(res, 200, { success: true, ...result });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/export' && req.method === 'GET') {
    try {
      const raw = await readFile(getOfficeDataPath(), 'utf8');
      sendJson(res, 200, { success: true, data: JSON.parse(raw) });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  if (path === '/import' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ data: unknown }>(req);
      await loadStore();
      const imported = body.data as Awaited<ReturnType<typeof loadStore>>;
      if (!imported || imported.version !== 2) {
        sendJson(res, 400, { success: false, error: 'Invalid office data' });
        return true;
      }
      await saveStore(imported);
      sendJson(res, 200, { success: true });
    } catch (e) {
      sendJson(res, 500, { success: false, error: String(e) });
    }
    return true;
  }

  return false;
}
