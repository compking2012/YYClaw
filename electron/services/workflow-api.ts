import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import type { GatewayManager } from '../gateway/manager';
import type { DynamicWorkflowDefinition } from '../workflow/dynamic/types';
import { generateDynamicWorkflow } from '../workflow/dynamic/generate';
import { runGatewayTurn } from '../workflow/adapter/gateway-adapter';
import { getWorkflowEngine } from '../workflow';
import { logger } from '../utils/logger';

export function createWorkflowApi(ctx: { gatewayManager: GatewayManager }): CompleteHostServiceRegistry['workflow'] {
  const engine = getWorkflowEngine(ctx.gatewayManager);
  return {
    list: () => ({
      success: true,
      definitions: engine.listDefinitions(),
      runs: engine.listRuns(),
    }),
    start: (payload) => {
      if (!payload.defId) return { success: false, error: 'defId is required' };
      const runId = engine.start(payload.defId, payload.input ?? {});
      return { success: true, runId, run: engine.getStatus(runId) as unknown as Record<string, unknown> | null };
    },
    resume: (payload) => {
      if (!payload.runId) return { success: false, error: 'runId is required' };
      return {
        success: true,
        resumed: engine.resume(payload.runId),
        run: engine.getStatus(payload.runId) as unknown as Record<string, unknown> | null,
      };
    },
    retry: async (payload) => {
      if (!payload.runId) return { success: false, error: 'runId is required' };
      const retried = await engine.retry(payload.runId);
      return {
        success: true,
        retried,
        run: engine.getStatus(payload.runId) as unknown as Record<string, unknown> | null,
      };
    },
    abort: (payload) => {
      if (!payload.runId) return { success: false, error: 'runId is required' };
      return {
        success: true,
        aborted: engine.abort(payload.runId),
        run: engine.getStatus(payload.runId) as unknown as Record<string, unknown> | null,
      };
    },
    status: (payload) => {
      if (!payload.runId) return { success: false, error: 'runId is required' };
      return { success: true, run: engine.getStatus(payload.runId) as unknown as Record<string, unknown> | null };
    },
    startDynamic: async (payload) => {
      let def = payload.definition as DynamicWorkflowDefinition | null | undefined;
      let matchedSkill: string | undefined;
      let resumeRequested = false;
      if (!def && typeof payload.task === 'string' && payload.task.trim()) {
        // Route generation through the gateway (like agent steps) so it uses the
        // gateway's configured model + auth (agents.defaults.model.primary,
        // including OAuth-only providers a direct REST call can't authenticate).
        const agentId =
          payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
            ? (payload.input as Record<string, unknown>).agentId
            : undefined;
        def = await generateDynamicWorkflow(payload.task, {
          agentId: typeof agentId === 'string' ? agentId : undefined,
          skills: payload.skills,
          onSkillMatch: (name) => { matchedSkill = name; },
          // Merged triage: when the conversation has an unfinished run, the SAME
          // generation call decides whether the message means "continue that run".
          resumable: payload.resumable
            ? { title: payload.resumable.title, steps: payload.resumable.steps, error: payload.resumable.error }
            : undefined,
          onResume: () => { resumeRequested = true; },
          runOnce: ({ system, input, timeoutMs }) =>
            runGatewayTurn(ctx.gatewayManager, {
              message: system ? `${system}\n\n${input}` : input,
              agentId: typeof agentId === 'string' ? agentId : undefined,
              timeoutMs: timeoutMs ?? 120_000,
            }),
        });
      }
      // The model judged this a request to continue the existing run — the
      // renderer drives `retry(resumable.runId)`; no new workflow is built.
      if (resumeRequested) {
        return { success: true, routed: false, resume: true };
      }
      if (!def || !Array.isArray(def.steps) || def.steps.length < 3) {
        logger.info(`[workflow:start-dynamic] not routed (unsuitable or <3 steps): steps=${def?.steps?.length ?? 0}`);
        return { success: true, routed: false, matchedSkill };
      }
      engine.registerDynamic(def);
      const input = payload.input ?? { goal: def.goal };
      const runId = engine.start(def.id, input);
      return {
        success: true,
        routed: true,
        runId,
        title: def.title,
        steps: def.steps.map((step) => ({ id: step.id, title: step.title, kind: step.kind, inputsFrom: step.inputsFrom })),
        run: engine.getStatus(runId) as unknown as Record<string, unknown> | null,
      };
    },
  };
}
