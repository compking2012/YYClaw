import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agent } from '../helpers/office-agents';
import { projectDirSegment } from '../../src/lib/office-project-context';

import { resolveRoomMessageSpeakerRoleId } from '../../src/lib/office-room-speaker-role';

describe('office deliverable paths and speaker resolution', () => {
  let testRoot = '';
  let previousOpenClawHome = '';

  beforeEach(async () => {
    vi.resetModules();
    previousOpenClawHome = process.env.OPENCLAW_HOME ?? '';
    testRoot = await mkdtemp(join(tmpdir(), 'office-audit-'));
    process.env.OPENCLAW_HOME = testRoot;
  });

  afterEach(async () => {
    process.env.OPENCLAW_HOME = previousOpenClawHome;
    await rm(testRoot, { recursive: true, force: true });
  });

  it('verifyDeliverablePathHintsExistOnDisk uses office project root', async () => {
    const teamMembers = [agent('a-planner', '上帝')];
    const { coordinatorProjectRoot } = await import(
      '../../electron/services/office/project-context-paths'
    );
    const root = coordinatorProjectRoot('demo', 'task-1');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '交付物-上帝.md'), 'x'.repeat(32), 'utf8');

    const { verifyDeliverablePathHintsExistOnDisk } = await import(
      '../../electron/services/office/workflow-project-deliverable-fs'
    );
    const result = await verifyDeliverablePathHintsExistOnDisk({
      project: { id: 'task-1', title: 'demo' },
      member: { agentId: 'a-planner', displayName: '上帝' },
      teamMembers,
      pathHints: ['交付物-上帝.md'],
    });
    expect(result.ok, result.detail).toBe(true);
    expect(root).toContain(join('office', 'project', projectDirSegment('demo', 'task-1')));
    expect(root).not.toContain('workspace-planner');
  });

  it('resolveRoomMessageSpeakerRoleId maps agentId to roster agent', () => {
    const team = [agent('a-planner', '上帝')];
    expect(
      resolveRoomMessageSpeakerRoleId(
        { from: 'agent', fromAgentId: 'a-planner', content: '【上帝】汇报' },
        team,
      ),
    ).toBe('a-planner');
    expect(
      resolveRoomMessageSpeakerRoleId(
        { from: 'a-planner', fromAgentId: undefined, content: '【上帝】汇报' },
        team,
      ),
    ).toBe('a-planner');
  });
});
