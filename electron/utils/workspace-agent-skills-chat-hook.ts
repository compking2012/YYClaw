/**
 * Chat runtime hooks: detect workspace skill install/uninstall signals and schedule reconcile.
 *
 * Strong signals (tool completion, filesystem command output) schedule reconcile immediately.
 * Weak signals (zip upload, strict message intent) are tracked until run.ended as a fallback.
 * Chat reconcile never triggers Gateway reload — Gateway watches openclaw.json independently.
 */

import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import { scheduleWorkspaceAgentSkillsReconcile } from './workspace-agent-skills-sync';

/** skills.install, skill_install, skill-workshop — not bare "skill". */
const SKILL_INSTALL_TOOL_NAME =
  /(?:^|[._-])skills[._-]install(?:$|[._-])|(?:^|[._-])skill[._-]install(?:$|[._-])|skill[_-]?workshop/i;

/** skills.uninstall / skills.remove / skill_uninstall — not bare delete. */
const SKILL_UNINSTALL_TOOL_NAME =
  /(?:^|[._-])skills[._-](?:uninstall|remove)(?:$|[._-])|(?:^|[._-])skill[._-](?:uninstall|remove)(?:$|[._-])/i;

const OPENCLAW_WORKSPACE_SKILLS_PATH =
  /\.openclaw[/\\]workspace(?:-[A-Za-z0-9._-]+)?[/\\]skills[/\\][^/\s"'`]+/i;

const FILESYSTEM_MUTATION_HINT =
  /\brm\b|\bunlink\b|\bremoved\b|\bdeleted\b|删除|卸载|移除|unzip|extract|installed|安装完成/i;

type TrackedRun = {
  reasons: Set<string>;
};

const trackedRuns = new Map<string, TrackedRun>();

function isZipMedia(mimeType?: string, fileName?: string): boolean {
  if (mimeType?.toLowerCase().includes('zip')) return true;
  return Boolean(fileName?.toLowerCase().endsWith('.zip'));
}

/** Strict message intent: skill/技能 must appear near an install/uninstall verb. */
export function messageMayMutateWorkspaceSkill(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return (
    /(?:安装|启用).{0,40}(?:skill|技能)|(?:skill|技能).{0,40}(?:安装|启用)/i.test(text)
    || /(?:卸载|禁用|移除|删除).{0,40}(?:skill|技能)|(?:skill|技能).{0,40}(?:卸载|禁用|移除|删除)/i.test(text)
    || /(?:install|enable).{0,40}(?:skill|skills)|(?:uninstall|disable).{0,40}(?:skill|skills)/i.test(text)
  );
}

export function skillInstallToolMayMutateWorkspace(name: string): boolean {
  return SKILL_INSTALL_TOOL_NAME.test(name.trim());
}

export function skillUninstallToolMayMutateWorkspace(name: string): boolean {
  return SKILL_UNINSTALL_TOOL_NAME.test(name.trim());
}

/** Command output must reference an OpenClaw workspace skills path plus a mutation hint. */
export function commandOutputMayMutateWorkspaceSkills(output: string): boolean {
  const text = output.trim();
  if (!text) return false;
  return OPENCLAW_WORKSPACE_SKILLS_PATH.test(text) && FILESYSTEM_MUTATION_HINT.test(text);
}

function isUninstallReason(reason: string): boolean {
  return reason.includes('uninstall') || reason === 'chat-skill-filesystem';
}

function reconcileDelayMs(reasons: Iterable<string>): number {
  for (const reason of reasons) {
    if (isUninstallReason(reason)) return 1000;
  }
  return 800;
}

function scheduleChatWorkspaceSkillReconcile(reasons: Set<string>): void {
  if (reasons.size === 0) return;
  const merged = [...reasons].sort().join('+');
  scheduleWorkspaceAgentSkillsReconcile(`chat-run:${merged}`, {
    delayMs: reconcileDelayMs(reasons),
  });
}

function noteChatRunMayMutateWorkspaceSkillsInternal(runId: string, reason: string): void {
  const trimmed = runId.trim();
  if (!trimmed) return;
  const existing = trackedRuns.get(trimmed) ?? { reasons: new Set<string>() };
  existing.reasons.add(reason);
  trackedRuns.set(trimmed, existing);
}

export function noteChatRunMayMutateWorkspaceSkills(params: {
  runId: string;
  reason: string;
}): void {
  noteChatRunMayMutateWorkspaceSkillsInternal(params.runId, params.reason);
}

export function noteChatSendMayMutateWorkspaceSkills(params: {
  runId: string;
  sessionKey?: string;
  message?: string;
  mimeType?: string;
  fileName?: string;
}): void {
  void params.sessionKey;
  const reasons = new Set<string>();
  if (isZipMedia(params.mimeType, params.fileName)) {
    reasons.add('chat-zip-media');
  }
  if (params.message && messageMayMutateWorkspaceSkill(params.message)) {
    const isUninstall = /(?:卸载|禁用|移除|删除|uninstall|disable|remove)/i.test(params.message);
    reasons.add(isUninstall ? 'chat-uninstall-intent' : 'chat-install-intent');
  }
  if (reasons.size === 0) return;
  for (const reason of reasons) {
    noteChatRunMayMutateWorkspaceSkillsInternal(params.runId, reason);
  }
}

/** @deprecated Prefer noteChatSendMayMutateWorkspaceSkills from chat-api sendWithMedia path. */
export function noteChatSendWithMediaMayMutateWorkspaceSkills(params: {
  runId: string;
  sessionKey?: string;
  message?: string;
  mimeType?: string;
  fileName?: string;
}): void {
  noteChatSendMayMutateWorkspaceSkills(params);
}

function handleStrongSignal(runId: string | undefined, reason: string): void {
  if (runId?.trim()) {
    noteChatRunMayMutateWorkspaceSkillsInternal(runId, reason);
  }
  scheduleChatWorkspaceSkillReconcile(new Set([reason]));
}

export function handleChatRuntimeEventForWorkspaceSkillSync(event: ChatRuntimeEvent): void {
  switch (event.type) {
    case 'tool.completed': {
      const name = typeof event.name === 'string' ? event.name : '';
      if (skillInstallToolMayMutateWorkspace(name)) {
        handleStrongSignal(event.runId, 'chat-skill-install-tool');
      } else if (skillUninstallToolMayMutateWorkspace(name)) {
        handleStrongSignal(event.runId, 'chat-skill-uninstall-tool');
      }
      break;
    }
    case 'command.output': {
      const output = typeof event.output === 'string' ? event.output : '';
      if (commandOutputMayMutateWorkspaceSkills(output)) {
        handleStrongSignal(event.runId, 'chat-skill-filesystem');
      }
      break;
    }
    case 'run.ended': {
      const runId = typeof event.runId === 'string' ? event.runId.trim() : '';
      if (!runId) break;
      const tracked = trackedRuns.get(runId);
      trackedRuns.delete(runId);
      if (!tracked || tracked.reasons.size === 0) break;
      scheduleChatWorkspaceSkillReconcile(tracked.reasons);
      break;
    }
    default:
      break;
  }
}

export function resetWorkspaceAgentSkillsChatHookForTests(): void {
  trackedRuns.clear();
}
