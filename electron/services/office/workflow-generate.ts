import type { GatewayManager } from '../../gateway/manager';
import { callModelOnce } from '../../workflow/model-client';
import { projectMembersFromIds } from '../../../src/lib/office-project-members';
import { agentDisplayLookup } from './office-member-resolve';
import { callAgentMessage } from './gateway-rpc';
import { roleDmSessionKey } from './session-keys';
import { waitForSessionReply } from './run-completion';
import { buildWorkflowGenerationPrompt } from './workflow-generate-prompt';
import {
  type WorkflowGenerateResult,
  type WorkflowGenerateSource,
  type WorkflowGenMember,
  generateLangGraphWorkflowFromDescriptionHeuristic,
  generateWorkflowFromDescriptionHeuristic,
  generateWorkflowFromDraft,
  parseWorkflowGenerationFromText,
  workflowGenMembersFromRefs,
} from '../../../src/lib/office-workflow-generate';
import { resolveWorkflowEngineInput } from '@/lib/feature-langgraph';
import {
  generateWorkflowFromStepDraftRows,
  trimWorkflowStepDraftRows,
} from '../../../src/lib/office-workflow-step-drafts';
import type { WorkflowStepDraftRow } from '../../../src/types/office';

export type WorkflowGenerateStrategy =
  | 'auto'
  | 'heuristic'
  | 'ai'
  | 'gateway-first'
  | 'gateway-then-direct';

const MODEL_GEN_TIMEOUT_MS = 60_000;
const MODEL_GEN_MAX_ATTEMPTS = 2;

async function loadWorkflowGenMembers(agentIds: string[]): Promise<WorkflowGenMember[]> {
  const lookup = await agentDisplayLookup();
  const refs = projectMembersFromIds(agentIds, lookup);
  return workflowGenMembersFromRefs(refs);
}

function materializeFromDraft(
  draft: NonNullable<ReturnType<typeof parseWorkflowGenerationFromText>>,
  teamMembers: WorkflowGenMember[],
  source: WorkflowGenerateSource,
  workflowEngine?: 'dag' | 'langgraph',
): WorkflowGenerateResult | null {
  return generateWorkflowFromDraft(draft, teamMembers, source, {
    orchestrationEngine: workflowEngine === 'langgraph' ? 'langgraph' : 'dag',
  });
}

async function tryGenerateWithModel(params: {
  description: string;
  teamMembers: WorkflowGenMember[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  workflowEngine?: 'dag' | 'langgraph';
}): Promise<WorkflowGenerateResult | null> {
  const prompt = buildWorkflowGenerationPrompt({
    description: params.description,
    teamRoles: params.teamMembers as never,
    taskTitle: params.taskTitle,
    coordinatorRoleId: params.coordinatorAgentId,
  });

  const source: WorkflowGenerateSource =
    params.workflowEngine === 'langgraph' ? 'langgraph_ai' : 'ai';

  for (let attempt = 0; attempt < MODEL_GEN_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { text } = await callModelOnce({
        system: '你是办公协同工作流设计助手，只输出 JSON。',
        input: prompt,
        temperature: 0,
        timeoutMs: MODEL_GEN_TIMEOUT_MS,
      });
      const draft = parseWorkflowGenerationFromText(text);
      if (!draft) continue;
      const result = materializeFromDraft(draft, params.teamMembers, source, params.workflowEngine);
      if (result) return result;
    } catch (err) {
      console.warn(`[office] model workflow generation attempt ${attempt + 1} failed:`, err);
    }
  }
  return null;
}

export async function generateWorkflowFromDescription(
  gateway: GatewayManager | null,
  params: {
    description: string;
    workflowStepDrafts?: WorkflowStepDraftRow[];
    agentIds: string[];
    coordinatorAgentId?: string;
    taskTitle?: string;
    strategy?: WorkflowGenerateStrategy;
    workflowEngine?: 'dag' | 'langgraph';
  },
): Promise<WorkflowGenerateResult | null> {
  const teamMembers = await loadWorkflowGenMembers(params.agentIds);
  if (teamMembers.length === 0) return null;

  const orchestrationEngine = resolveWorkflowEngineInput('workflow', params.workflowEngine);
  const trimmedDrafts = trimWorkflowStepDraftRows(params.workflowStepDrafts ?? []);
  if (trimmedDrafts.length > 0) {
    const refs = projectMembersFromIds(params.agentIds, (agentId) =>
      teamMembers.find((m) => m.agentId === agentId)?.name,
    );
    const fromDrafts = generateWorkflowFromStepDraftRows(
      trimmedDrafts,
      refs,
      orchestrationEngine,
    );
    if (fromDrafts) return fromDrafts;
  }

  const description = params.description.trim();
  if (!description) return null;

  const strategy = params.strategy ?? 'auto';

  const modelFirstParams = {
    description,
    teamMembers,
    coordinatorAgentId: params.coordinatorAgentId,
    taskTitle: params.taskTitle,
    workflowEngine: orchestrationEngine,
  };

  async function tryModelThenGateway(): Promise<WorkflowGenerateResult | null> {
    const modelResult = await tryGenerateWithModel(modelFirstParams);
    if (modelResult) return modelResult;
    if (gateway) {
      return tryGenerateWithGateway(gateway, modelFirstParams);
    }
    return null;
  }

  async function tryGatewayThenModel(): Promise<WorkflowGenerateResult | null> {
    if (gateway) {
      const gatewayResult = await tryGenerateWithGateway(gateway, modelFirstParams);
      if (gatewayResult) return gatewayResult;
    }
    return tryGenerateWithModel(modelFirstParams);
  }

  function fallbackHeuristic(): WorkflowGenerateResult | null {
    if (orchestrationEngine === 'langgraph') {
      return generateLangGraphWorkflowFromDescriptionHeuristic(description, teamMembers);
    }
    return generateWorkflowFromDescriptionHeuristic(description, teamMembers);
  }

  if (strategy === 'gateway-then-direct') {
    return tryGatewayThenModel();
  }

  if (strategy === 'gateway-first') {
    const aiResult = await tryGatewayThenModel();
    if (aiResult) return aiResult;
    return fallbackHeuristic();
  }

  if (strategy === 'heuristic') {
    const aiResult = await tryModelThenGateway();
    if (aiResult) return aiResult;
    return fallbackHeuristic();
  }

  if (strategy === 'ai' || strategy === 'auto') {
    const aiResult = await tryModelThenGateway();
    if (aiResult) return aiResult;
    if (strategy === 'ai') return null;
  }

  return fallbackHeuristic();
}

async function tryGenerateWithGateway(
  gateway: GatewayManager,
  params: {
    description: string;
    teamMembers: WorkflowGenMember[];
    coordinatorAgentId?: string;
    taskTitle?: string;
    workflowEngine?: 'dag' | 'langgraph';
  },
): Promise<WorkflowGenerateResult | null> {
  const coordinator =
    params.teamMembers.find((m) => m.agentId === params.coordinatorAgentId)
    ?? params.teamMembers[0];
  if (!coordinator) return null;

  const sessionKey = roleDmSessionKey(
    coordinator.agentId,
    coordinator.agentId,
    `workflow-gen-${Date.now()}`,
  );
  const prompt = buildWorkflowGenerationPrompt({
    description: params.description,
    teamRoles: params.teamMembers as never,
    taskTitle: params.taskTitle,
    coordinatorRoleId: params.coordinatorAgentId,
  });

  try {
    const startedAt = Date.now();
    const sent = await callAgentMessage(gateway, sessionKey, prompt, `office-wf-gen-${startedAt}`);
    const wait = await waitForSessionReply(gateway, {
      sessionKey,
      startedAtMs: startedAt,
      timeoutMs: 90_000,
      runId: sent.runId,
      allowUndatedFallback: true,
    });
    const text = wait.assistantText?.trim();
    if (!text?.trim()) return null;

    const draft = parseWorkflowGenerationFromText(text);
    if (!draft) return null;

    const source: WorkflowGenerateSource =
      params.workflowEngine === 'langgraph' ? 'langgraph_ai' : 'ai';
    return materializeFromDraft(draft, params.teamMembers, source, params.workflowEngine);
  } catch (err) {
    console.warn('[office] gateway AI workflow generation failed:', err);
    return null;
  }
}
