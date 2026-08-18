/**
 * Renderer-side cheap triage for "should this turn run as a workflow?".
 *
 * Whitelist-style gate: a turn is only worth handing to the server's semantic
 * decision (`generateDynamicWorkflow`) when the text actually reads like a
 * multi-step task — a numbered/bulleted list, sequencing connectors
 * ("first/then/finally", "首先…然后…最后"), or explicit step language. Plain
 * one-shot questions (even long ones) are NOT routed, so a normal chat reply is
 * the default.
 *
 * Rationale: the previous blacklist ("route everything that isn't a greeting")
 * routed nearly every substantive message, spending a generation turn on tasks
 * that never decompose and making the app feel like it "randomly" enters
 * workflow mode. Combined with the (default-off) auto-workflow toggle, this
 * whitelist keeps auto-routing to genuinely multi-step requests.
 *
 * Bias is still conservative about accepting: a false negative just means a
 * normal chat reply; the server still returns routed:false when a task that
 * passes this gate turns out not to decompose into enough steps.
 */
import { classifyIntent } from '@/lib/intent-classifier';
import { looksLikeWorkflowText } from '@shared/workflow/skill-workflow';

/**
 * True only when the text reads like a multi-step task AND isn't an obvious
 * greeting / one-shot Q&A. The server makes the final call on whether it
 * actually decomposes into a workflow.
 */
export function shouldRouteToWorkflow(text: string): boolean {
  const trimmed = text.trim();
  if (!looksLikeWorkflowText(trimmed)) return false;
  return classifyIntent({ text: trimmed }).intent !== 'quick_qa';
}
