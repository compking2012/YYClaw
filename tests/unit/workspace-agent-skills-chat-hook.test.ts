import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRuntimeEvent } from '@shared/chat-runtime-events';
import {
  commandOutputMayMutateWorkspaceSkills,
  handleChatRuntimeEventForWorkspaceSkillSync,
  messageMayMutateWorkspaceSkill,
  noteChatSendMayMutateWorkspaceSkills,
  resetWorkspaceAgentSkillsChatHookForTests,
  skillInstallToolMayMutateWorkspace,
  skillUninstallToolMayMutateWorkspace,
} from '@electron/utils/workspace-agent-skills-chat-hook';

const scheduleMock = vi.fn();

vi.mock('@electron/utils/workspace-agent-skills-sync', () => ({
  scheduleWorkspaceAgentSkillsReconcile: (...args: unknown[]) => scheduleMock(...args),
}));

describe('workspace-agent-skills-chat-hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scheduleMock.mockReset();
    resetWorkspaceAgentSkillsChatHookForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('detects strict uninstall intent in chat messages', () => {
    expect(messageMayMutateWorkspaceSkill('请卸载 zhanhui-manhua 技能')).toBe(true);
    expect(messageMayMutateWorkspaceSkill('uninstall official-yyclaw-ppt skill')).toBe(true);
    expect(messageMayMutateWorkspaceSkill('how to remove skill requirement')).toBe(false);
    expect(messageMayMutateWorkspaceSkill('hello world')).toBe(false);
  });

  it('does not treat bare skill tool names as install/uninstall signals', () => {
    expect(skillInstallToolMayMutateWorkspace('skill')).toBe(false);
    expect(skillInstallToolMayMutateWorkspace('skills.install')).toBe(true);
    expect(skillUninstallToolMayMutateWorkspace('delete')).toBe(false);
    expect(skillUninstallToolMayMutateWorkspace('skills.uninstall')).toBe(true);
  });

  it('requires openclaw workspace skills path in command output', () => {
    expect(commandOutputMayMutateWorkspaceSkills(
      'rm -rf /Users/me/.openclaw/workspace/skills/zhanhui-manhua',
    )).toBe(true);
    expect(commandOutputMayMutateWorkspaceSkills('npm deleted package skill-utils')).toBe(false);
  });

  it('tracks zip media sends and reconciles when the run ends', () => {
    noteChatSendMayMutateWorkspaceSkills({
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      mimeType: 'application/zip',
      fileName: 'official-yyclaw-ppt.zip',
    });

    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'run.ended',
      runId: 'run-1',
      status: 'completed',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).toHaveBeenCalledWith(
      'chat-run:chat-zip-media',
      { delayMs: 800 },
    );
  });

  it('tracks uninstall message intent from chat.send and reconciles on run end', () => {
    noteChatSendMayMutateWorkspaceSkills({
      runId: 'run-uninstall',
      sessionKey: 'agent:main:main',
      message: '卸载 workspace 里的 zhanhui-manhua 技能',
    });

    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'run.ended',
      runId: 'run-uninstall',
      status: 'completed',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).toHaveBeenCalledWith(
      'chat-run:chat-uninstall-intent',
      { delayMs: 1000 },
    );
  });

  it('schedules reconcile immediately after skill uninstall tool completion', () => {
    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'tool.completed',
      runId: 'run-2',
      toolCallId: 't1',
      name: 'skills.uninstall',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).toHaveBeenCalledWith(
      'chat-run:chat-skill-uninstall-tool',
      { delayMs: 1000 },
    );
  });

  it('schedules reconcile immediately when rm under workspace skills appears in command output', () => {
    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'command.output',
      runId: 'run-3',
      output: 'removed /Users/me/.openclaw/workspace/skills/zhanhui-manhua',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).toHaveBeenCalledWith(
      'chat-run:chat-skill-filesystem',
      { delayMs: 1000 },
    );
  });

  it('schedules reconcile immediately after skill install tool completion', () => {
    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'tool.completed',
      runId: 'run-4',
      toolCallId: 't1',
      name: 'skills.install',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).toHaveBeenCalledWith(
      'chat-run:chat-skill-install-tool',
      { delayMs: 800 },
    );
  });

  it('ignores run.ended when the run was not tracked', () => {
    handleChatRuntimeEventForWorkspaceSkillSync({
      type: 'run.ended',
      runId: 'run-unknown',
      status: 'completed',
    } satisfies ChatRuntimeEvent);

    expect(scheduleMock).not.toHaveBeenCalled();
  });
});
