import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

const ACTIVE_RUN_FILENAME = 'active_run.json';

export function getPromptOptimizationActiveRunFilePath(): string {
  return join(homedir(), '.openclaw', 'logs', 'prompt_optimization', ACTIVE_RUN_FILENAME);
}

export function writePromptOptimizationActiveRunFile(sessionKey: string, runId: string): void {
  const filePath = getPromptOptimizationActiveRunFilePath();
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    filePath,
    JSON.stringify({ sessionKey, runId, updatedAt: new Date().toISOString() }),
    'utf-8',
  );
}
