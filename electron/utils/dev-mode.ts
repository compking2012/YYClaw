/**
 * In-process cache for Settings > Developer > dev mode.
 * Updated when settings are read/written so hot paths can log verbosely without async store reads.
 */
let devModeUnlockedCache = false;

export function isDevModeUnlocked(): boolean {
  if (process.env.CLAWX_DEV_MODE_UNLOCKED === '1') {
    return true;
  }
  return devModeUnlockedCache;
}

export function setDevModeUnlockedCache(value: boolean): void {
  devModeUnlockedCache = value;
}

export async function refreshDevModeUnlockedCache(
  readDevMode: () => Promise<boolean>,
): Promise<void> {
  devModeUnlockedCache = await readDevMode();
}
