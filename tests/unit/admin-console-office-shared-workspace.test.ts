import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAgentsSnapshot: vi.fn(),
}));

// Isolate the shared-workspace mirror from the real ~/.openclaw so tests don't
// write to / read from the user's actual OpenClaw config directory.
const openclawConfigDir = mkdtempSync(join(tmpdir(), 'openclaw-config-'));
vi.mock('@electron/utils/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/utils/paths')>();
  return { ...actual, getOpenClawConfigDir: () => openclawConfigDir };
});

afterAll(async () => {
  await rm(openclawConfigDir, { recursive: true, force: true });
});

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: mocks.listAgentsSnapshot,
}));

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function makeAgentWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'office-shared-workspace-'));
  mocks.listAgentsSnapshot.mockResolvedValue({
    agents: [{
      id: 'agent-a',
      name: 'Agent A',
      workspace: dir,
      isDefault: false,
      modelDisplay: 'test',
      modelRef: null,
      overrideModelRef: null,
      overrideImageModelRef: null,
      overrideImageGenerationModelRef: null,
      overrideVideoGenerationModelRef: null,
      overrideMusicGenerationModelRef: null,
      inheritedModel: false,
      agentDir: join(dir, 'agent'),
      mainSessionKey: 'agent:agent-a:main',
      channelTypes: [],
    }],
    defaultAgentId: 'agent-a',
    defaultModelRef: null,
    defaultImageModelRef: null,
    defaultImageGenerationModelRef: null,
    defaultVideoGenerationModelRef: null,
    defaultMusicGenerationModelRef: null,
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
  });
  return dir;
}

describe('Admin Console office shared workspace RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepares a local mirror from chunked files', async () => {
    await makeAgentWorkspace();
    const { handleOfficeSharedWorkspaceRpc } = await import('@electron/services/admin-console/office-shared-workspace');
    const content = Buffer.from('hello shared workspace');

    const result = await handleOfficeSharedWorkspaceRpc({
      op: 'prepare',
      workspace_id: 'ws-1',
      agent_id: 'agent-a',
      revision: 'rev-1',
      chunks: [{
        file_id: 'f1',
        path: 'notes/readme.md',
        offset: 0,
        size: content.length,
        total_size: content.length,
        sha256: sha256(content),
        is_last_chunk: true,
        content_base64: content.toString('base64'),
      }],
    });

    expect(result.ok).toBe(true);
    expect(result.project_root).toContain(join('office', 'admin-shared', 'ws-1'));
    await expect(readFile(join(result.project_root!, 'notes', 'readme.md'), 'utf8'))
      .resolves.toBe('hello shared workspace');
  });

  it('snapshots changed files and commit advances the baseline revision', async () => {
    await makeAgentWorkspace();
    const { handleOfficeSharedWorkspaceRpc } = await import('@electron/services/admin-console/office-shared-workspace');
    const prepared = await handleOfficeSharedWorkspaceRpc({
      op: 'prepare',
      workspace_id: 'ws-2',
      agent_id: 'agent-a',
      revision: 'rev-1',
      files: [{
        path: 'base.txt',
        size: 4,
        sha256: sha256('base'),
        content_base64: Buffer.from('base').toString('base64'),
      }],
    });
    expect(prepared.ok).toBe(true);

    await writeFile(join(prepared.project_root!, 'result.txt'), 'done', 'utf8');
    const snapshot = await handleOfficeSharedWorkspaceRpc({
      op: 'snapshot',
      workspace_id: 'ws-2',
      agent_id: 'agent-a',
    });
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'result.txt', size: 4, sha256: sha256('done') }),
    ]));

    const committed = await handleOfficeSharedWorkspaceRpc({
      op: 'commit',
      workspace_id: 'ws-2',
      agent_id: 'agent-a',
      revision: 'rev-2',
    });
    expect(committed.ok).toBe(true);
    expect(committed.revision).toBe('rev-2');

    const after = await handleOfficeSharedWorkspaceRpc({
      op: 'snapshot',
      workspace_id: 'ws-2',
      agent_id: 'agent-a',
    });
    expect(after.files).toEqual([]);
  });

  it('rejects traversal paths and symlink writes', async () => {
    const workspace = await makeAgentWorkspace();
    const { handleOfficeSharedWorkspaceRpc } = await import('@electron/services/admin-console/office-shared-workspace');

    const traversal = await handleOfficeSharedWorkspaceRpc({
      op: 'prepare',
      workspace_id: 'ws-3',
      agent_id: 'agent-a',
      files: [{
        path: '../escape.txt',
        content_base64: Buffer.from('nope').toString('base64'),
        size: 4,
      }],
    });
    expect(traversal.ok).toBe(false);
    expect(traversal.error?.code).toBe('INVALID_PATH');

    const prepared = await handleOfficeSharedWorkspaceRpc({
      op: 'prepare',
      workspace_id: 'ws-3',
      agent_id: 'agent-a',
    });
    await symlink(join(workspace, 'outside.txt'), join(prepared.project_root!, 'link.txt'));
    const symlinkWrite = await handleOfficeSharedWorkspaceRpc({
      op: 'push_chunk',
      workspace_id: 'ws-3',
      agent_id: 'agent-a',
      chunks: [{
        path: 'link.txt',
        offset: 0,
        size: 4,
        content_base64: Buffer.from('nope').toString('base64'),
        is_last_chunk: true,
      }],
    });
    expect(symlinkWrite.ok).toBe(false);
    expect(symlinkWrite.error?.code).toBe('INVALID_PATH');
  });

  it('rejects final chunks with a mismatched sha256', async () => {
    await makeAgentWorkspace();
    const { handleOfficeSharedWorkspaceRpc } = await import('@electron/services/admin-console/office-shared-workspace');

    const result = await handleOfficeSharedWorkspaceRpc({
      op: 'prepare',
      workspace_id: 'ws-4',
      agent_id: 'agent-a',
      chunks: [{
        path: 'bad.bin',
        offset: 0,
        size: 3,
        total_size: 3,
        sha256: sha256('different'),
        is_last_chunk: true,
        content_base64: Buffer.from('bad').toString('base64'),
      }],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('HASH_MISMATCH');
  });
});

describe('Admin shared workspace chat policy', () => {
  it('decorates chat.send params only when office_shared_workspace metadata exists', async () => {
    const { decorateChatSendParamsWithAdminSharedWorkspace } = await import('@electron/services/admin-console/office-shared-workspace');

    expect(decorateChatSendParamsWithAdminSharedWorkspace({
      message: 'hello',
      metadata: {},
    })).toEqual({ message: 'hello' });

    const decorated = decorateChatSendParamsWithAdminSharedWorkspace({
      message: 'build it',
      __admin_console_metadata: {
        office_shared_workspace: {
          workspace_id: 'ws-5',
          project_root: '/tmp/shared/ws-5',
          revision: 'rev-a',
        },
      },
    }) as { message: string };

    expect(decorated.message).toContain('Admin Console shared workspace policy');
    expect(decorated.message).toContain('/tmp/shared/ws-5');
    expect(decorated.message).toContain('build it');
  });
});
