import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomMessage } from '../../electron/services/office/types';

const getRoomMessages = vi.fn();
const getFixedGroup = vi.fn();

vi.mock('../../electron/services/office/store', () => ({
  getRoomMessages: (...args: unknown[]) => getRoomMessages(...args),
  getFixedGroup: (...args: unknown[]) => getFixedGroup(...args),
}));

vi.mock('../../electron/services/office/office-member-resolve', () => ({
  membersForFixedGroup: vi.fn(async () => []),
}));

import {
  scheduleUnmentionedCoordinatorWatch,
  onRoomMessageWrittenForUnmentionedWatch,
  cancelUnmentionedWatch,
  UNMENTIONED_RESPONSE_WAIT_MS,
} from '../../electron/services/office/room-unmentioned-coordinator';

type WatchParams = Parameters<typeof scheduleUnmentionedCoordinatorWatch>[0];

function makeWatchParams(overrides: Partial<WatchParams> = {}): WatchParams {
  const triggerMsg: RoomMessage = {
    id: 't1',
    groupId: 'g1',
    projectId: 'p1',
    from: 'agent',
    fromAgentId: 'a1',
    content: '未点名的自述发言',
    mentions: [],
    timestamp: Date.now(),
  };
  return {
    gateway: {} as WatchParams['gateway'],
    scenarioId: 'g1',
    coordinatorRoleId: 'pm',
    coordinatorAgentId: 'pm',
    scenarioName: 'Group',
    focusTask: null,
    group: null,
    replyQuote: null,
    roomContext: null,
    speakerLabel: 'A1',
    content: '未点名的自述发言',
    triggerMsg,
    teamMembers: [{ agentId: 'a2', displayName: 'B' }],
    allMembers: [{ agentId: 'a2', displayName: 'B' }],
    ...overrides,
  };
}

describe('unmentioned coordinator watch — cancel key consistency', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getRoomMessages.mockReset();
    cancelUnmentionedWatch('g1');
  });

  afterEach(() => {
    cancelUnmentionedWatch('g1');
    cancelUnmentionedWatch('p-standalone');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Regression guard: new-model room messages carry `groupId` but no legacy `scenarioId`.
  // The cancel must resolve the same key as the lookup (`scenarioId ?? groupId ?? ''`),
  // otherwise a teammate's reply fails to cancel the watch and the coordinator
  // intervention fires spuriously after the wait window.
  it('cancels the watch when a teammate replies with only groupId (no scenarioId)', async () => {
    const runIntervention = vi.fn(async () => {});
    scheduleUnmentionedCoordinatorWatch(makeWatchParams(), runIntervention);

    const reply: RoomMessage = {
      id: 'r1',
      groupId: 'g1',
      projectId: 'p1',
      from: 'agent',
      fromAgentId: 'a2',
      content: '这是队友对该发言的实质回复',
      mentions: [],
      timestamp: Date.now(),
    };
    onRoomMessageWrittenForUnmentionedWatch(reply, new Set(['a2']));

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 500);

    // Watch was cancelled → timer cleared → callback never queries history nor intervenes.
    expect(getRoomMessages).not.toHaveBeenCalled();
    expect(runIntervention).not.toHaveBeenCalled();
  });

  it('cancels watch when reply only has projectId but watch registered via groupId on trigger', async () => {
    const runIntervention = vi.fn(async () => {});
    scheduleUnmentionedCoordinatorWatch(
      makeWatchParams({
        scenarioId: 'g1',
        triggerMsg: {
          id: 't1',
          groupId: 'g1',
          projectId: 'p1',
          from: 'agent',
          fromAgentId: 'a1',
          content: '未点名的自述发言',
          mentions: [],
          timestamp: Date.now(),
        },
      }),
      runIntervention,
    );

    const reply: RoomMessage = {
      id: 'r1',
      projectId: 'p1',
      from: 'agent',
      fromAgentId: 'a2',
      content: '这是队友对该发言的实质回复',
      mentions: [],
      timestamp: Date.now(),
    };
    onRoomMessageWrittenForUnmentionedWatch(reply, new Set(['a2']));

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 500);

    expect(getRoomMessages).not.toHaveBeenCalled();
    expect(runIntervention).not.toHaveBeenCalled();
  });

  it('cancels watch keyed by projectId for standalone projects (no groupId/scenarioId)', async () => {
    const runIntervention = vi.fn(async () => {});
    scheduleUnmentionedCoordinatorWatch(
      makeWatchParams({
        scenarioId: 'p-standalone',
        triggerMsg: {
          id: 't1',
          projectId: 'p-standalone',
          from: 'agent',
          fromAgentId: 'a1',
          content: '未点名的自述发言',
          mentions: [],
          timestamp: Date.now(),
        },
      }),
      runIntervention,
    );

    const reply: RoomMessage = {
      id: 'r1',
      projectId: 'p-standalone',
      from: 'agent',
      fromAgentId: 'a2',
      content: '这是队友对该发言的实质回复',
      mentions: [],
      timestamp: Date.now(),
    };
    onRoomMessageWrittenForUnmentionedWatch(reply, new Set(['a2']));

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 500);

    expect(getRoomMessages).not.toHaveBeenCalled();
    expect(runIntervention).not.toHaveBeenCalled();
  });

  // Contrast: without a teammate reply the watch must still fire, proving the
  // assertion above is meaningful (the timer is genuinely wired up).
  it('fires intervention when nobody replies', async () => {
    const runIntervention = vi.fn(async () => {});
    const params = makeWatchParams();
    getRoomMessages.mockResolvedValue([params.triggerMsg]);
    scheduleUnmentionedCoordinatorWatch(params, runIntervention);

    await vi.advanceTimersByTimeAsync(UNMENTIONED_RESPONSE_WAIT_MS + 500);

    expect(getRoomMessages).toHaveBeenCalled();
    expect(runIntervention).toHaveBeenCalledTimes(1);
  });
});
