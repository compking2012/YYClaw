/**
 * Electron-facing bootstrap for the workflow engine.
 *
 * Assembles the process-wide singleton with the real headless adapter and a
 * userData-backed snapshot store, registers the built-in workflows, and exposes
 * it to the main process. This is the ONLY workflow module that imports electron
 * — the engine core stays electron-free for testability and future reuse.
 */
import { app } from 'electron';
import { join } from 'node:path';
import type { GatewayManager } from '../gateway/manager';
import { WorkflowEngine } from './engine';
import { SnapshotStore } from './snapshot-store';
import { HeadlessAdapter } from './adapter/headless-adapter';
import { GatewayBackedAdapter } from './adapter/gateway-adapter';
import { registerBuiltinWorkflows } from './definitions';

let engine: WorkflowEngine | null = null;

/**
 * Returns the process-wide workflow engine. Pass the gateway on first call so
 * `agent` steps can drive a real agent loop (chat.send); without it the engine
 * falls back to the headless adapter (deterministic + model steps only).
 */
export function getWorkflowEngine(gateway?: GatewayManager): WorkflowEngine {
  if (!engine) {
    const store = new SnapshotStore(join(app.getPath('userData'), 'workflows'));
    const adapter = gateway ? new GatewayBackedAdapter(gateway) : new HeadlessAdapter();
    engine = new WorkflowEngine({ adapter, store });
    registerBuiltinWorkflows(engine);
  }
  return engine;
}

export { WorkflowEngine } from './engine';
export type { RunRecord, RunStatus, StepKind, TraceEntry } from './types';
