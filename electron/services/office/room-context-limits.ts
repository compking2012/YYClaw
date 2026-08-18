import type { OfficeTaskExecutionMode } from './types';

export type RoomContextLimits = { maxMessages: number; maxChars: number };

export function roomContextLimitsForMention(
  executionMode: OfficeTaskExecutionMode,
  isCoordinator: boolean,
): RoomContextLimits {
  if (executionMode === 'smart') {
    return isCoordinator
      ? { maxMessages: 2, maxChars: 3_200 }
      : { maxMessages: 2, maxChars: 2_000 };
  }
  return { maxMessages: 5, maxChars: 3_500 };
}
