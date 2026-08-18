import { describe, expect, it } from 'vitest';
import {
  roleDmSessionKey,
  roleP2PSessionKey,
  roleTaskRoomDmSuffix,
  roleTaskSessionKey,
  roomSessionKey,
  taskRoomSessionKey,
} from '../../electron/services/office/session-keys';

describe('office session-keys', () => {
  it('roleTaskSessionKey includes optional workflowRunId', () => {
    expect(roleTaskSessionKey('a1', 'r1', 't1', 'n1')).toBe(
      'agent:a1:office:task:t1:role:r1:node:n1',
    );
    expect(roleTaskSessionKey('a1', 'r1', 't1', 'n1', 'run-9')).toContain(':run:run-9');
  });

  it('roleP2PSessionKey and task room keys', () => {
    expect(roleP2PSessionKey('a1', 'peer', 'thread-1')).toBe(
      'agent:a1:office:p2p:peer:thread-1',
    );
    expect(taskRoomSessionKey('coord', 'task-1')).toBe('agent:coord:office:task-room:task-1');
    expect(roomSessionKey('coord', 'task-1')).toBe(taskRoomSessionKey('coord', 'task-1'));
  });

  it('role dm suffix and session key', () => {
    expect(roleTaskRoomDmSuffix('task-1')).toBe('task-task-1');
    expect(roleDmSessionKey('a1', 'r1', 'task-task-1')).toBe(
      'agent:a1:office:role:r1:dm:task-task-1',
    );
  });
});
