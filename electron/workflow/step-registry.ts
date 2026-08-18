// @ts-nocheck
/**
 * Local step registry — the implementations behind `callTool`.
 *
 * Tools are plain, model-free async functions registered ONCE here. The headless
 * adapter dispatches to them directly (validate → execute), with nothing in
 * between: no model constructs the args, no agent hook/middleware runs, no
 * session side effects. That is what makes `callTool` 100% deterministic.
 *
 * (Phase 2 will additionally let these same implementations be exposed to
 * OpenClaw's agent as standard plugins — "write once, expose twice".)
 */
import type { ZodType } from 'zod';

export interface StepTool<TArgs = unknown, TResult = unknown> {
  name: string;
  schema: ZodType<TArgs>;
  run: (args: TArgs) => Promise<TResult> | TResult;
}

export class StepRegistry {
  private readonly tools = new Map<string, StepTool>();

  register<TArgs, TResult>(tool: StepTool<TArgs, TResult>): void {
    this.tools.set(tool.name, tool as StepTool);
  }

  get(name: string): StepTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/** Process-wide registry shared by the default headless adapter. */
export const stepRegistry = new StepRegistry();
