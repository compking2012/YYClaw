// @ts-nocheck
/**
 * Template rendering for dynamic workflow steps.
 *
 * A step's `goalTemplate` may reference prior step outputs via `{{stepId}}` and
 * the overall task via `{{goal}}`. Rendering substitutes those placeholders with
 * values accumulated in `context.results` — this is how each step's result is
 * fed forward as the next step's input.
 *
 * Pure function, no side effects — unit-testable.
 */
import type { DynamicWorkflowContext } from './types';

/** Stringify a prior step's output for injection into a template. */
function stringifyResult(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Replace `{{goal}}` and `{{stepId}}` placeholders in `template` using the run
 * context. Unknown placeholders render as empty string (a missing upstream
 * result must not leak the literal `{{...}}` into the agent prompt).
 */
export function renderTemplate(template: string, context: DynamicWorkflowContext): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, key: string) => {
    if (key === 'goal') return context.goal ?? '';
    return stringifyResult(context.results[key]);
  });
}
