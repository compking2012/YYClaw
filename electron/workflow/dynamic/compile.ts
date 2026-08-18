// @ts-nocheck
/**
 * Compiles a data-driven {@link DynamicWorkflowDefinition} into a real XState
 * machine + a standard {@link WorkflowDefinition}, so dynamic workflows become
 * first-class citizens of the existing WorkflowEngine (same snapshot/resume/
 * `workflow:progress` machinery, same audit trace, same UI data layer).
 *
 * Control flow is linear in Phase 1 (`step.next`); the unified context shape
 * `{ goal, agentId, results, errorMessage }` is pure JSON so persisted
 * snapshots resume without re-running completed steps. Branching (DAG) is a
 * future extension on top of this builder.
 */
import { setup, fromPromise, assign, type AnyStateMachine } from 'xstate';
import { z } from 'zod';
import type { OpenClawAdapter } from '../adapter/openclaw-adapter';
import type { StepKind, WorkflowDefinition } from '../types';
import type {
  DynamicStep,
  DynamicWorkflowContext,
  DynamicWorkflowDefinition,
  DynamicWorkflowInput,
} from './types';
import { renderTemplate } from './template';

const DONE_STATE = 'done';
const FAILED_STATE = 'failed';

/** Default budget for `agent` steps (wall-clock bound keeps a step from stalling a run). */
const DEFAULT_AGENT_BUDGET = { maxSteps: 40, maxTokens: 200_000, timeoutMs: 300_000 };

/** `agent` steps return free text in Phase 1. */
const AgentTextSchema = z.string();
/** `model` steps emit a single JSON object so the constrained model call has a schema to satisfy. */
const ModelOutputSchema = z.object({ output: z.string() });

const DEFAULT_MODEL_SYSTEM =
  'You complete ONE step of a larger task. Use the provided input and respond with the result only.';

type StepActorInput = { rendered: string; context: DynamicWorkflowContext };

/** Build the promise actor that performs a single step via the adapter. */
function stepActor(step: DynamicStep, adapter: OpenClawAdapter) {
  return fromPromise(async ({ input }: { input: StepActorInput }) => {
    const { rendered, context } = input;
    if (step.kind === 'agent') {
      const { result } = await adapter.runAgent<string>({
        goal: rendered,
        budget: DEFAULT_AGENT_BUDGET,
        resultSchema: AgentTextSchema,
        agentId: context.agentId,
        runId: context.runId,
        stepId: step.id,
        parentSessionKey: context.parentSessionKey,
      });
      return result;
    }
    if (step.kind === 'model') {
      const out = await adapter.runModel<{ output: string }>({
        system: step.systemPrompt ?? DEFAULT_MODEL_SYSTEM,
        input: rendered,
        schema: ModelOutputSchema,
        agentId: context.agentId,
        runId: context.runId,
        stepId: step.id,
      });
      return out.output;
    }
    // deterministic
    if (!step.tool) {
      throw new Error(`deterministic step "${step.id}" is missing a tool name`);
    }
    return adapter.callTool(step.tool, {
      rendered,
      goal: context.goal,
      results: context.results,
    });
  });
}

/** Compile the dynamic definition into an XState machine bound to the adapter. */
export function compileToMachine(
  def: DynamicWorkflowDefinition,
  adapter: OpenClawAdapter,
): AnyStateMachine {
  if (def.steps.length === 0) {
    throw new Error(`dynamic workflow "${def.id}" has no steps`);
  }

  const actors: Record<string, ReturnType<typeof fromPromise>> = {};
  for (const step of def.steps) {
    actors[step.id] = stepActor(step, adapter);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const states: Record<string, any> = {};
  for (const step of def.steps) {
    const isTerminal = (step.next ?? DONE_STATE) === DONE_STATE;
    states[step.id] = {
      // Resume support: if this step's output is already present in context
      // (seeded from a prior run's snapshot via `resumeResults`), skip it — the
      // eventless `always` transition fires on entry, before the `invoke` runs,
      // so completed steps never re-execute when a failed/aborted run continues.
      always: [
        {
          guard: ({ context }: { context: DynamicWorkflowContext }) =>
            context.results?.[step.id] != null,
          target: step.next ?? DONE_STATE,
        },
      ],
      invoke: {
        src: step.id,
        input: ({ context }: { context: DynamicWorkflowContext }): StepActorInput => ({
          rendered: renderTemplate(step.goalTemplate, context),
          context,
        }),
        onDone: {
          target: step.next ?? DONE_STATE,
          actions: assign({
            results: ({ context, event }: { context: DynamicWorkflowContext; event: { output: unknown } }) => ({
              ...context.results,
              [step.id]: event.output,
            }),
            // The step that transitions to DONE is the run's terminal step; its
            // output is the final result the engine surfaces to the UI.
            finalResult: ({ context, event }: { context: DynamicWorkflowContext; event: { output: unknown } }) =>
              isTerminal ? String(event.output ?? '') : context.finalResult,
          }),
        },
        onError: {
          target: FAILED_STATE,
          actions: assign({
            errorMessage: ({ event }: { event: { error: unknown } }) => String(event.error),
          }),
        },
      },
    };
  }
  states[DONE_STATE] = { type: 'final' };
  states[FAILED_STATE] = { type: 'final' };

  return setup({
    types: {} as { context: DynamicWorkflowContext; input: DynamicWorkflowInput },
    actors,
  }).createMachine({
    id: def.id,
    initial: def.entry,
    context: ({ input }: { input: DynamicWorkflowInput }): DynamicWorkflowContext => ({
      goal: input?.goal ?? def.goal,
      agentId: input?.agentId,
      runId: input?.runId,
      parentSessionKey: input?.parentSessionKey,
      // Seed prior outputs when resuming so completed steps are skipped.
      results: input?.resumeResults ?? {},
      finalResult: undefined,
      errorMessage: null,
    }),
    states,
  }) as unknown as AnyStateMachine;
}

/** Wrap a dynamic definition as a standard WorkflowDefinition for the engine. */
export function compileDynamicDefinition(def: DynamicWorkflowDefinition): WorkflowDefinition {
  const stepKinds: Record<string, StepKind> = {};
  for (const step of def.steps) {
    stepKinds[step.id] = step.kind;
  }
  return {
    id: def.id,
    version: def.version,
    title: def.title,
    stepKinds,
    createMachine: (adapter) => compileToMachine(def, adapter),
  };
}
