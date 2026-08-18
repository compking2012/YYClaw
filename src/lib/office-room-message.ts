import type { RoomMessage, RoomMessagePhase } from '@/types/office';

export function isRoomMessagePhase(value: unknown): value is RoomMessagePhase {
  return (
    value === 'task_received' ||
    value === 'task_understanding' ||
    value === 'task_team_review' ||
    value === 'task_clarification' ||
    value === 'task_running' ||
    value === 'task_deliver' ||
    value === 'task_handoff' ||
    value === 'project_closure'
  );
}

export function roomMessageProgressText(m: RoomMessage): string {
  return (m.progressText ?? m.content ?? '').trim();
}

export function roomMessageHeaderLine(m: RoomMessage): string {
  const first = m.content.split('\n')[0]?.trim();
  return first || m.content;
}
