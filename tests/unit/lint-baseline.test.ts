// @vitest-environment node
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('repository lint baseline', () => {
  it('ignores generated evidence and temporary worktree copies', async () => {
    const eslint = new ESLint();
    for (const filePath of [
      'artifacts/autopilot/run/workspaces/task/repo/src/App.tsx',
      'test-results/report.ts',
      'playwright-report/report.ts',
    ]) {
      await expect(eslint.isPathIgnored(filePath)).resolves.toBe(true);
    }
  });

  it('keeps source and renderer boundary errors enforced', async () => {
    const eslint = new ESLint();
    await expect(eslint.isPathIgnored('src/App.tsx')).resolves.toBe(false);
    const config = await eslint.calculateConfigForFile('src/App.tsx');
    for (const rule of [
      '@typescript-eslint/ban-ts-comment',
      '@typescript-eslint/no-unused-vars',
      'react-hooks/refs',
      'react-hooks/set-state-in-effect',
      'no-restricted-syntax',
    ]) {
      expect(config.rules[rule][0]).toBe(2);
    }
  });
});
