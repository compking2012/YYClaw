import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { isOfficeCollaborationEnabled } from '@shared/office-collaboration-feature';
import { isOfficeSidebarSessionVisibilityEnabled } from '@shared/internal-session';
import { formatSessionSidebarMarkdown } from '../../../src/lib/office-session-sidebar-md';
import type { GatewayManager } from '../../gateway/manager';
import { fetchChatHistory } from './gateway-rpc';
import { OFFICE_PROJECT_SESSION_DIR, officeProjectSessionDirPath } from './office-project-session-dir';

export const OFFICE_AGENT_SESSION_MD_SYNC_INTERVAL_MS = 20_000;
export const OFFICE_AGENT_SESSION_MD_FINISH_RETRIES = 4;
export const OFFICE_AGENT_SESSION_MD_FINISH_RETRY_MS = 500;

const RUN_BLOCK_HEADER_RE = /^## Run /m;

export function shouldExportOfficeAgentSessionMd(): boolean {
  return isOfficeCollaborationEnabled() && !isOfficeSidebarSessionVisibilityEnabled();
}

/** Workflow agent node session keys (`agent:*:office:task:*:role:*:node:*`). */
export function isOfficeWorkflowAgentNodeSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:office:task:[^:]+:role:[^:]+:node:/.test(sessionKey.trim());
}

/** Smart per-role project DM session keys (`agent:*:office:role:*:dm:task-*`). */
export function isOfficeSmartRoleDmSessionKey(sessionKey: string): boolean {
  return /^agent:[^:]+:office:role:[^:]+:dm:task-/.test(sessionKey.trim());
}

export function isOfficeExportableAgentSessionKey(sessionKey: string): boolean {
  return (
    isOfficeWorkflowAgentNodeSessionKey(sessionKey)
    || isOfficeSmartRoleDmSessionKey(sessionKey)
  );
}

export function sanitizeRoleDisplayNameForMdFile(roleDisplayName: string): string {
  const trimmed = roleDisplayName.trim() || 'agent';
  return trimmed.replace(/[/\\?%*:|"<>]/g, '_');
}

export function officeAgentSessionMdPath(projectRoot: string, roleDisplayName: string): string {
  const safeName = sanitizeRoleDisplayNameForMdFile(roleDisplayName);
  return join(officeProjectSessionDirPath(projectRoot), `session_${safeName}.md`);
}

export { OFFICE_PROJECT_SESSION_DIR };

function hashMarkdownBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

function runBlockHeader(runId: string | undefined, startedAtMs: number): string {
  const ts = new Date(startedAtMs).toISOString();
  const runSuffix = runId?.trim() ? ` · runId=${runId.trim()}` : '';
  return `## Run ${ts}${runSuffix}\n\n`;
}

function splitCompletedRunBlocks(existing: string): string[] {
  const trimmed = existing.trimEnd();
  if (!trimmed) return [];
  const parts = trimmed.split(/\n\n---\n\n/);
  return parts.filter((part) => part.trim().length > 0);
}

function isCurrentRunBlock(block: string, runId: string | undefined): boolean {
  if (!runId?.trim()) return false;
  return block.includes(`runId=${runId.trim()}`);
}

async function readExistingMd(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function writeSessionMdFile(
  filePath: string,
  previousRuns: string[],
  currentRunHeader: string,
  currentBody: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const prefix = previousRuns.length > 0 ? `${previousRuns.join('\n\n---\n\n')}\n\n---\n\n` : '';
  const content = `${prefix}${currentRunHeader}${currentBody}`.trimEnd() + '\n';
  await writeFile(filePath, content, 'utf8');
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export type OfficeAgentSessionMdSyncHandle = {
  setRunId: (runId: string | undefined) => void;
  stop: () => void;
  finish: () => Promise<void>;
};

export function startOfficeAgentSessionMdSync(params: {
  gateway: GatewayManager;
  sessionKey: string;
  projectRoot: string;
  roleDisplayName: string;
  startedAtMs: number;
  runId?: string;
}): OfficeAgentSessionMdSyncHandle | null {
  if (!shouldExportOfficeAgentSessionMd()) return null;
  if (!isOfficeExportableAgentSessionKey(params.sessionKey)) return null;

  const filePath = officeAgentSessionMdPath(params.projectRoot, params.roleDisplayName);
  let runId = params.runId;
  let stopped = false;
  let lastWrittenHash = '';
  let syncInFlight = false;

  const syncOnce = async (opts?: { urgent?: boolean }): Promise<boolean> => {
    if (stopped || syncInFlight) return false;
    syncInFlight = true;
    let wrote = false;
    try {
      const history = await fetchChatHistory(
        params.gateway,
        params.sessionKey,
        200,
        opts?.urgent ? { urgent: true } : undefined,
      );
      const body = formatSessionSidebarMarkdown(history.messages);
      const hash = hashMarkdownBody(body);
      if (!body.trim() || hash === lastWrittenHash) return false;

      const existing = await readExistingMd(filePath);
      const blocks = splitCompletedRunBlocks(existing);
      const previousRuns = blocks.filter((block) => !isCurrentRunBlock(block, runId));
      const header = runBlockHeader(runId, params.startedAtMs);
      await writeSessionMdFile(filePath, previousRuns, header, body);
      lastWrittenHash = hash;
      wrote = true;
    } catch (e) {
      console.warn('[office][session-md] sync failed', {
        sessionKey: params.sessionKey,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      syncInFlight = false;
    }
    return wrote;
  };

  void syncOnce();
  const timer = setInterval(() => {
    void syncOnce();
  }, OFFICE_AGENT_SESSION_MD_SYNC_INTERVAL_MS);

  return {
    setRunId: (nextRunId) => {
      runId = nextRunId;
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    finish: async () => {
      stopped = true;
      clearInterval(timer);
      for (let attempt = 0; attempt < OFFICE_AGENT_SESSION_MD_FINISH_RETRIES; attempt++) {
        const wrote = await syncOnce({ urgent: true });
        if (wrote || attempt === OFFICE_AGENT_SESSION_MD_FINISH_RETRIES - 1) break;
        await sleepMs(OFFICE_AGENT_SESSION_MD_FINISH_RETRY_MS);
      }
    },
  };
}

/** @internal test helper */
export function parseSessionMdRunBlocks(markdown: string): string[] {
  return splitCompletedRunBlocks(markdown).filter((block) => RUN_BLOCK_HEADER_RE.test(block));
}
