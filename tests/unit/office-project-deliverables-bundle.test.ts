import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/office/store', () => ({
  appendRoomMessage: vi.fn(),
  getTempProject: vi.fn(),
  listFixedGroups: vi.fn(),
  getRoomMessages: vi.fn(),
}));

describe('project deliverables bundle', () => {
  const prevHome = process.env.OPENCLAW_HOME;
  const tempRoots: string[] = [];

  const makeTempRoot = (prefix: string): string => {
    const root = join(tmpdir(), prefix, String(Date.now()));
    tempRoots.push(root);
    return root;
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.OPENCLAW_HOME;
    else process.env.OPENCLAW_HOME = prevHome;
    vi.resetModules();
    await Promise.all(
      tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it(
    'shouldPublishDeliverablesBundleOnCompletion gates running→completed',
    async () => {
      const { shouldPublishDeliverablesBundleOnCompletion } = await import(
        '../../electron/services/office/project-deliverables-bundle'
      );
      expect(
        shouldPublishDeliverablesBundleOnCompletion(
          { status: 'completed' },
          'running',
        ),
      ).toBe(true);
      expect(
        shouldPublishDeliverablesBundleOnCompletion(
          { status: 'completed' },
          'pending',
        ),
      ).toBe(true);
      expect(
        shouldPublishDeliverablesBundleOnCompletion(
          { status: 'completed' },
          'completed',
        ),
      ).toBe(false);
      expect(
        shouldPublishDeliverablesBundleOnCompletion({ status: 'running' }, 'running'),
      ).toBe(false);
      expect(
        shouldPublishDeliverablesBundleOnCompletion({ status: 'completed' }, 'aborted'),
      ).toBe(true);
      expect(
        shouldPublishDeliverablesBundleOnCompletion({ status: 'completed' }, 'failed'),
      ).toBe(true);
    },
    15_000,
  );

  it('isCoordinatorClosureRoomMessage accepts smart end and workflow closure', async () => {
    const {
      isCoordinatorClosureRoomMessage,
      isSmartCoordinatorClosureAnchor,
      roomMessageLooksLikeCoordinatorClosure,
    } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );
    expect(
      isCoordinatorClosureRoomMessage(
        { fromAgentId: 'coord', smartCoordinatorEnd: true, phase: 'project_closure' },
        'coord',
      ),
    ).toBe(true);
    expect(
      isCoordinatorClosureRoomMessage(
        { fromAgentId: 'member', smartCoordinatorEnd: true, phase: undefined },
        'coord',
      ),
    ).toBe(false);
    expect(
      isSmartCoordinatorClosureAnchor(
        {
          fromAgentId: 'coord',
          smartCoordinatorEnd: undefined,
          content: '✅ 港股分析报告验收通过！',
          progressText: '',
        },
        'coord',
      ),
    ).toBe(false);
    expect(
      isSmartCoordinatorClosureAnchor(
        {
          fromAgentId: 'coord',
          smartCoordinatorEnd: undefined,
          content: '全部完成，感谢协作。\n\n【结项】',
          progressText: '',
        },
        'coord',
      ),
    ).toBe(true);
    const workflowClosure = {
      fromAgentId: 'coord',
      smartCoordinatorEnd: undefined as boolean | undefined,
      phase: 'project_closure' as const,
      content: '🤖 【CEO助理】📋 项目收尾 · 国产GPGPU芯片的发展前景材料撰写',
      progressText: '',
    };
    expect(isCoordinatorClosureRoomMessage(workflowClosure, 'coord')).toBe(true);
    expect(isSmartCoordinatorClosureAnchor(workflowClosure, 'coord')).toBe(false);
    expect(roomMessageLooksLikeCoordinatorClosure(workflowClosure, 'coord')).toBe(true);
  });

  it('deliverablesBundleCoversClosure detects stale bundle before final closure', async () => {
    const { deliverablesBundleCoversClosure } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );
    expect(
      deliverablesBundleCoversClosure(
        { timestamp: 1000, replyToId: 'c-old' },
        { timestamp: 2000, id: 'c-new' },
      ),
    ).toBe(false);
    expect(
      deliverablesBundleCoversClosure(
        { timestamp: 3000, replyToId: 'c-new' },
        { timestamp: 2000, id: 'c-new' },
      ),
    ).toBe(true);
    expect(
      deliverablesBundleCoversClosure(
        { timestamp: 5000, replyToId: 'c-old' },
        { timestamp: 2000, id: 'c-new' },
      ),
    ).toBe(false);
    expect(
      deliverablesBundleCoversClosure(
        { timestamp: 5000, replyToId: undefined },
        { timestamp: 2000, id: 'c-new' },
      ),
    ).toBe(false);
  });

  it('buildDeliverablesBundleRoomContent uses prominent system download copy', async () => {
    const { buildDeliverablesBundleRoomContent } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );
    const content = buildDeliverablesBundleRoomContent({
      taskTitle: '股市分析与投资规划',
      bundle: {
        zipAbsPath: '/tmp/股市分析与投资规划.zip',
        displayName: '股市分析与投资规划.zip',
        fileCount: 5,
        zipBytes: 50_823,
      },
    });
    expect(content).toContain('【可下载】');
    expect(content).toContain('另存为');
    expect(content).not.toContain('【上帝】');
  });

  it('names zip as <项目名>.zip', async () => {
    const { projectDeliverablesBundleFileName } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );
    expect(projectDeliverablesBundleFileName('五子棋 Demo')).toBe('五子棋 Demo.zip');
  });

  it('packs substantive files under 交付物-Agent dirs and excludes system artifacts', async () => {
    const testRoot = makeTempRoot('yyclaw-deliverables-bundle');
    process.env.OPENCLAW_HOME = testRoot;
    const projectRoot = join(testRoot, 'proj');
    const deliverableDir = join(projectRoot, '交付物-产品');
    await mkdir(deliverableDir, { recursive: true });
    await mkdir(join(projectRoot, '.session'), { recursive: true });
    await writeFile(join(projectRoot, 'progress.json'), '{}', 'utf8');
    await writeFile(join(projectRoot, 'requirements-产品.md'), 'x'.repeat(32), 'utf8');
    await writeFile(join(deliverableDir, 'requirements-产品.md'), 'x'.repeat(32), 'utf8');
    await writeFile(join(projectRoot, '.session', 'session_产品.md'), 'x'.repeat(32), 'utf8');
    await writeFile(join(projectRoot, 'demo.zip'), 'old', 'utf8');

    const { collectAllSubstantiveDeliverableFiles } = await import(
      '../../electron/services/office/workflow-project-deliverable-fs'
    );
    const { buildProjectDeliverablesZipArchive } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );

    const files = await collectAllSubstantiveDeliverableFiles(projectRoot, { projectTitle: '五子棋' });
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('交付物-产品/requirements-产品.md');

    const bundle = await buildProjectDeliverablesZipArchive({
      projectTitle: '五子棋',
      projectId: 'proj-1',
      projectRoot,
    });
    expect(bundle?.displayName).toBe('五子棋.zip');
    expect(bundle?.fileCount).toBe(1);
  });

  it('buildProjectDeliverablesZipArchive reads from recorded projectRootPath', async () => {
    const recordedRoot = makeTempRoot('yyclaw-deliverables-recorded-root');
    const titleRoot = makeTempRoot('yyclaw-deliverables-title-root');
    const deliverableDir = join(recordedRoot, '交付物-成员');
    await mkdir(deliverableDir, { recursive: true });
    await writeFile(join(deliverableDir, 'deliverable-a.md'), 'x'.repeat(32), 'utf8');

    const { getTempProject } = await import('../../electron/services/office/store');
    vi.mocked(getTempProject).mockResolvedValue({
      id: 'p1',
      title: '新标题',
      projectRootPath: recordedRoot,
      coordinatorAgentId: 'coord',
      agentIds: [],
      status: 'running',
    } as never);

    const { resolveOfficeProjectRootForSessionMd } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const { buildProjectDeliverablesZipArchive } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );

    const resolved = await resolveOfficeProjectRootForSessionMd({
      id: 'p1',
      title: '新标题',
      projectRootPath: recordedRoot,
    } as never);
    expect(resolved).toBe(recordedRoot);

    const bundle = await buildProjectDeliverablesZipArchive({
      projectTitle: '新标题',
      projectId: 'p1',
      projectRoot: resolved,
    });
    expect(bundle?.fileCount).toBe(1);
    expect(bundle?.zipAbsPath.startsWith(recordedRoot)).toBe(true);
    expect(bundle?.zipAbsPath.startsWith(titleRoot)).toBe(false);
  });

  it('publishProjectDeliverablesBundleMessage defers room side effects to avoid Smart finalize deadlock', async () => {
    const { appendRoomMessage, getRoomMessages, getTempProject } = await import(
      '../../electron/services/office/store'
    );
    const appendSpy = vi.mocked(appendRoomMessage);
    appendSpy.mockImplementation(async (msg) => msg as never);
    vi.mocked(getTempProject).mockResolvedValue({
      id: 'p1',
      title: 'demo',
      coordinatorAgentId: 'coord',
      projectRootPath: '/tmp/demo',
    } as never);

    const closure = {
      id: 'closure-1',
      projectId: 'p1',
      fromAgentId: 'coord',
      smartCoordinatorEnd: true,
      content: '结项\n\n【结项】',
      timestamp: 100,
    };
    vi.mocked(getRoomMessages).mockResolvedValue([closure as never]);

    const bundleMod = await import('../../electron/services/office/project-deliverables-bundle');
    vi.spyOn(bundleMod, 'buildProjectDeliverablesZipArchive').mockResolvedValue({
      zipAbsPath: '/tmp/demo.zip',
      displayName: 'demo.zip',
      fileCount: 1,
      zipBytes: 64,
    });

    await bundleMod.publishProjectDeliverablesBundleMessage(null, {
      project: { id: 'p1', title: 'demo', coordinatorAgentId: 'coord' },
      afterMessageId: closure.id,
      coordinatorAgentId: 'coord',
      closure: closure as never,
    });

    expect(appendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'deliverable_bundle' }),
      { deferSideEffects: true },
    );
  });

  it('removeProjectDeliverablesBundle deletes zip on disk', async () => {
    const testRoot = makeTempRoot('yyclaw-deliverables-remove');
    process.env.OPENCLAW_HOME = testRoot;
    const projectId = 'proj-1';
    const projectTitle = 'demo';
    const projectRoot = join(testRoot, 'office', 'project', projectId);
    await mkdir(projectRoot, { recursive: true });
    const zipPath = join(projectRoot, 'demo.zip');
    await writeFile(zipPath, 'zip-bytes', 'utf8');

    const { removeProjectDeliverablesBundle } = await import(
      '../../electron/services/office/project-deliverables-bundle'
    );
    await removeProjectDeliverablesBundle(projectTitle, projectId);
    await expect(access(zipPath)).rejects.toBeDefined();
  });
});
