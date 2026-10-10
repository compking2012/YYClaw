import { isDevModeUnlocked } from '../../utils/dev-mode';
import { logger } from '../../utils/logger';

/** Centrifuge lifecycle / status logs: full context only when dev mode is on. */
export function logCentrifugeInfo(message: string, detail?: unknown): void {
  if (detail !== undefined && isDevModeUnlocked()) {
    logger.info(message, detail);
    return;
  }
  logger.info(message);
}

export function logCentrifugeError(message: string, detail?: unknown): void {
  if (detail !== undefined && isDevModeUnlocked()) {
    logger.error(message, detail);
    return;
  }
  logger.error(message);
}
