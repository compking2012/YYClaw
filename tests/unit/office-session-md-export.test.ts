import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configureSidebarOfficeSessionVisibility } from '@shared/internal-session';
import {
  isOfficeSessionNewStartedSnippet,
  isSubstantiveWorkflowProgressSnippet,
} from '../../electron/services/office/room-mention-reply-policy';

describe('isOfficeSessionNewStartedSnippet', () => {
  it('matches session-new system lines', () => {
    expect(isOfficeSessionNewStartedSnippet('New session started')).toBe(true);
    expect(isOfficeSessionNewStartedSnippet('New session started.')).toBe(true);
    expect(isOfficeSessionNewStartedSnippet('✅ New session started.')).toBe(true);
  });

  it('does not match substantive agent progress', () => {
    expect(isOfficeSessionNewStartedSnippet('正在整理交付产物 JSON')).toBe(false);
  });
});

describe('isSubstantiveWorkflowProgressSnippet session-new filter', () => {
  it('rejects New session started snippets', () => {
    expect(isSubstantiveWorkflowProgressSnippet('✅ New session started.')).toBe(false);
    expect(isSubstantiveWorkflowProgressSnippet('New session started')).toBe(false);
  });

  it('still accepts substantive progress', () => {
    expect(isSubstantiveWorkflowProgressSnippet('已完成输入校验，开始执行数据挖掘')).toBe(true);
  });
});

describe('office-agent-session-md-export gate', () => {
  afterEach(async () => {
    const { resetSidebarOfficeSessionVisibility } = await import('@shared/internal-session');
    resetSidebarOfficeSessionVisibility();
  });

  it('exports when collaboration on and sidebar sessions hidden', async () => {
    configureSidebarOfficeSessionVisibility(false);
    const { shouldExportOfficeAgentSessionMd } = await import(
      '../../electron/services/office/office-agent-session-md-export'
    );
    expect(shouldExportOfficeAgentSessionMd()).toBe(true);
  });

  it('skips export when sidebar sessions visible', async () => {
    configureSidebarOfficeSessionVisibility(true);
    const { shouldExportOfficeAgentSessionMd } = await import(
      '../../electron/services/office/office-agent-session-md-export'
    );
    expect(shouldExportOfficeAgentSessionMd()).toBe(false);
  });
});

describe('formatSessionSidebarMarkdown', () => {
  it('keeps user and assistant turns, drops internal heartbeats', async () => {
    const { formatSessionSidebarMarkdown } = await import('../../src/lib/office-session-sidebar-md');
    const md = formatSessionSidebarMarkdown([
      { role: 'user', content: '请开始任务', timestamp: 1_700_000_000_000 },
      { role: 'assistant', content: 'NO_REPLY', timestamp: 1_700_000_001_000 },
      { role: 'assistant', content: '【任务理解】开始执行', timestamp: 1_700_000_002_000 },
    ]);
    expect(md).toContain('请开始任务');
    expect(md).toContain('【任务理解】');
    expect(md).not.toContain('NO_REPLY');
  });
});

describe('officeAgentSessionMdPath', () => {
  it('places file under project session directory', async () => {
    const { officeAgentSessionMdPath } = await import(
      '../../electron/services/office/office-agent-session-md-export'
    );
    expect(officeAgentSessionMdPath('/tmp/proj', '数据挖掘师')).toMatch(/\.session[/\\]session_数据挖掘师\.md$/);
  });
});

describe('isOfficeExportableAgentSessionKey', () => {
  it('accepts workflow node and smart role dm keys', async () => {
    const {
      isOfficeExportableAgentSessionKey,
      isOfficeSmartRoleDmSessionKey,
      isOfficeWorkflowAgentNodeSessionKey,
    } = await import('../../electron/services/office/office-agent-session-md-export');
    const workflowKey = 'agent:dev:office:task:proj-1:role:dev:node:gen-0';
    const smartKey = 'agent:illustrator:office:role:illustrator:dm:task-proj-1';
    expect(isOfficeWorkflowAgentNodeSessionKey(workflowKey)).toBe(true);
    expect(isOfficeSmartRoleDmSessionKey(smartKey)).toBe(true);
    expect(isOfficeExportableAgentSessionKey(workflowKey)).toBe(true);
    expect(isOfficeExportableAgentSessionKey(smartKey)).toBe(true);
    expect(isOfficeExportableAgentSessionKey('agent:dev:office:task-room:proj-1')).toBe(false);
  });
});

describe('startOfficeAgentSessionMdSync smart session keys', () => {
  afterEach(async () => {
    const { resetSidebarOfficeSessionVisibility } = await import('@shared/internal-session');
    resetSidebarOfficeSessionVisibility();
  });

  it('starts sync for smart role dm session keys when export gate is open', async () => {
    configureSidebarOfficeSessionVisibility(false);
    const { startOfficeAgentSessionMdSync } = await import(
      '../../electron/services/office/office-agent-session-md-export'
    );
    const handle = startOfficeAgentSessionMdSync({
      gateway: {
        request: async () => ({ messages: [] }),
      } as never,
      sessionKey: 'agent:illustrator:office:role:illustrator:dm:task-proj-1',
      projectRoot: '/tmp/smart-proj',
      roleDisplayName: '漫画插画师',
      startedAtMs: Date.now(),
    });
    expect(handle).not.toBeNull();
    handle?.stop();
  });
});

describe('resolveOfficeProjectRootForSessionMd', () => {
  it('prefers existing recorded projectRootPath over title-based path', async () => {
    const { mkdir, rm } = await import('node:fs/promises');
    const recordedRoot = join(tmpdir(), `office-session-md-recorded-${Date.now()}`);
    await mkdir(recordedRoot, { recursive: true });
    try {
      const { resolveOfficeProjectRootForSessionMd } = await import(
        '../../electron/services/office/project-context-paths'
      );
      const root = await resolveOfficeProjectRootForSessionMd({
        id: 'p1',
        title: '新标题',
        projectRootPath: recordedRoot,
      } as never);
      expect(root).toBe(recordedRoot);
    } finally {
      await rm(recordedRoot, { recursive: true, force: true });
    }
  });

  it('differs from title-prefixed legacy segment when store path is id-only', async () => {
    const { mkdir, rm } = await import('node:fs/promises');
    const recordedRoot = join(tmpdir(), `office-session-md-recorded-${Date.now()}`);
    await mkdir(recordedRoot, { recursive: true });
    try {
      const { resolveOfficeProjectRootForSessionMd, projectRoot } = await import(
        '../../electron/services/office/project-context-paths'
      );
      const { legacyProjectDirSegment } = await import('../../src/lib/office-project-context');
      const project = {
        id: 'p1',
        title: '新标题',
        projectRootPath: recordedRoot,
      } as never;
      const sessionRoot = await resolveOfficeProjectRootForSessionMd(project);
      expect(sessionRoot).toBe(recordedRoot);
      expect(sessionRoot).not.toBe(projectRoot('新标题', 'p1'));
      expect(legacyProjectDirSegment('新标题', 'p1')).toBe('新标题-p1');
    } finally {
      await rm(recordedRoot, { recursive: true, force: true });
    }
  });
});
