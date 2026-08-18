import { readFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import {
  getPromptOptimizationActiveRunFilePath,
  writePromptOptimizationActiveRunFile,
} from '../../electron/api/prompt-optimization-active-run-file';

describe('prompt-optimization-active-run-file', () => {
  const filePath = getPromptOptimizationActiveRunFilePath();

  afterEach(() => {
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  });

  it('writes sessionKey and runId for preload to read', () => {
    writePromptOptimizationActiveRunFile('agent:main:main', 'run-abc');
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { sessionKey: string; runId: string };
    expect(parsed.sessionKey).toBe('agent:main:main');
    expect(parsed.runId).toBe('run-abc');
    expect(filePath.startsWith(homedir())).toBe(true);
  });
});
