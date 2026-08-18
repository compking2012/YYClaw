import { describe, expect, it } from 'vitest';
import { projectAcpObservedWorkflow } from '@/lib/acp/observed-workflow-projection';
import type { AcpTimelineSnapshot, TimelineItem } from '@/lib/acp/timeline-types';

function timeline(items: TimelineItem[], sessionId = 'agent:main:s1'): AcpTimelineSnapshot {
  const itemsById: AcpTimelineSnapshot['itemsById'] = {};
  const itemOrder: string[] = [];
  for (const item of items) {
    itemsById[item.id] = item;
    itemOrder.push(item.id);
  }
  return {
    sessionId,
    loadGeneration: 1,
    itemOrder,
    itemsById,
    metadata: {},
    openMessageSegments: {},
    segmentCounts: {},
  };
}

function userSeg(id: string, text: string): TimelineItem {
  return {
    kind: 'message-segment',
    id,
    role: 'user',
    messageId: id,
    segmentIndex: 0,
    parts: [{ kind: 'markdown', text }],
  };
}

function readTool(id: string, path: string): TimelineItem {
  return {
    kind: 'tool-call',
    id,
    toolCallId: id,
    title: `Read: ${path}`,
    toolKind: 'read',
    status: 'completed',
    input: { path },
    outputParts: [],
    locations: [],
  };
}

function planTool(
  id: string,
  todos: Array<{ content: string; status: string }>,
): TimelineItem {
  return {
    kind: 'tool-call',
    id,
    toolCallId: id,
    title: 'update_plan',
    status: 'completed',
    input: { todos },
    outputParts: [],
    locations: [],
  };
}

const travelPath = '/Users/me/.openclaw/skills/travel-planner/SKILL.md';
const researchPath = '/Users/me/.openclaw/skills/deep-research/SKILL.md';

function resolveSkill(path: string) {
  if (path.includes('travel-planner')) return { name: 'travel-planner', title: 'Travel Planner' };
  if (path.includes('deep-research')) return { name: 'deep-research', title: 'Deep Research' };
  return null;
}

describe('projectAcpObservedWorkflow — latest activation per user turn', () => {
  it('returns null when the timeline has no workflow-shaped tools', () => {
    const snap = timeline([userSeg('u1', 'hello')]);
    expect(projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal).toBeNull();
  });

  it('attributes a single activation to the preceding user message', () => {
    const snap = timeline([
      userSeg('u1', 'plan a trip'),
      readTool('r1', travelPath),
      planTool('p1', [
        { content: 'step-a', status: 'completed' },
        { content: 'step-b', status: 'in_progress' },
      ]),
    ]);
    const signal = projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal;
    expect(signal).toMatchObject({
      activationKey: 'u1',
      userMessageId: 'u1',
      userText: 'plan a trip',
      skill: { name: 'travel-planner', title: 'Travel Planner' },
      hasPlan: true,
    });
    expect(signal?.todos).toEqual([
      { content: 'step-a', status: 'completed' },
      { content: 'step-b', status: 'in_progress' },
    ]);
  });

  it('uses the LATEST user-turn activation, not the first', () => {
    const snap = timeline([
      userSeg('u1', 'first trip'),
      readTool('r1', travelPath),
      planTool('p1', [
        { content: 'old-a', status: 'completed' },
        { content: 'old-b', status: 'in_progress' },
      ]),
      userSeg('u2', 'second trip'),
      readTool('r2', travelPath),
      planTool('p2', [
        { content: 'new-a', status: 'pending' },
        { content: 'new-b', status: 'pending' },
      ]),
    ]);
    const signal = projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal;
    expect(signal).toMatchObject({
      activationKey: 'u2',
      userMessageId: 'u2',
      userText: 'second trip',
      skill: { name: 'travel-planner' },
      hasPlan: true,
    });
    expect(signal?.todos.map((t) => t.content)).toEqual(['new-a', 'new-b']);
  });

  it('keeps the previous activation when a later user turn has no workflow tools', () => {
    const snap = timeline([
      userSeg('u1', 'trip'),
      readTool('r1', travelPath),
      planTool('p1', [{ content: 'a', status: 'in_progress' }]),
      userSeg('u2', 'unrelated follow-up'),
    ]);
    const signal = projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal;
    expect(signal?.activationKey).toBe('u1');
    expect(signal?.userText).toBe('trip');
  });

  it('scopes skill + plan to the same latest turn (no cross-turn mix)', () => {
    const snap = timeline([
      userSeg('u1', 'research'),
      readTool('r1', researchPath),
      planTool('p1', [{ content: 'research-step', status: 'completed' }]),
      userSeg('u2', 'travel'),
      readTool('r2', travelPath),
      planTool('p2', [{ content: 'travel-step', status: 'in_progress' }]),
    ]);
    const signal = projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal;
    expect(signal).toMatchObject({
      activationKey: 'u2',
      skill: { name: 'travel-planner' },
    });
    expect(signal?.todos).toEqual([{ content: 'travel-step', status: 'in_progress' }]);
  });

  it('ignores non-workflow Read paths', () => {
    const snap = timeline([
      userSeg('u1', 'hi'),
      readTool('r1', '/tmp/notes.md'),
      planTool('p1', [{ content: 'a', status: 'pending' }]),
    ]);
    const signal = projectAcpObservedWorkflow({
      timeline: snap,
      resolveWorkflowSkillByReadPath: resolveSkill,
    }).signal;
    expect(signal?.skill).toBeNull();
    expect(signal?.hasPlan).toBe(true);
    expect(signal?.activationKey).toBe('u1');
  });
});
