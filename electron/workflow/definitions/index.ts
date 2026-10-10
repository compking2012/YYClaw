/**
 * Registers the built-in workflows (and their deterministic tools) into an
 * engine instance. Kept separate from the engine so tests can register a subset.
 */
import type { WorkflowEngine } from '../engine';
import { demoReportDefinition, registerDemoTools } from './demo-report';

export function registerBuiltinWorkflows(engine: WorkflowEngine): void {
  registerDemoTools();
  engine.register(demoReportDefinition);
}
