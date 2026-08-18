import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const requireCjs = createRequire(import.meta.url);
const gates = requireCjs('../../electron/gateway/fetch-preload-gates.cjs') as typeof import('../../electron/gateway/fetch-preload-gates.cjs');

const LLM_URL = 'https://api.example.com/v1/chat/completions';

describe('fetch-preload-gates', () => {
  it('intercepts and optimizes only when prompt optimization is enabled', () => {
    const on = gates.resolveFetchGates({ CLAWX_PROMPT_OPTIMIZATION_ENABLED: '1' }, LLM_URL);
    expect(on.shouldOptimize).toBe(true);
    expect(on.shouldDump).toBe(false);
    expect(on.shouldIntercept).toBe(true);

    const devOnly = gates.resolveFetchGates({ CLAWX_DEV_MODE_UNLOCKED: '1' }, LLM_URL);
    expect(devOnly.shouldOptimize).toBe(false);
    expect(devOnly.shouldDump).toBe(false);
    expect(devOnly.shouldIntercept).toBe(false);
  });

  it('writes llm_dump only when prompt optimization and developer mode are both enabled', () => {
    const both = gates.resolveFetchGates(
      {
        CLAWX_PROMPT_OPTIMIZATION_ENABLED: '1',
        CLAWX_DEV_MODE_UNLOCKED: '1',
      },
      LLM_URL,
    );
    expect(both.shouldDump).toBe(true);

    const promptOnly = gates.resolveFetchGates(
      { CLAWX_PROMPT_OPTIMIZATION_ENABLED: '1' },
      LLM_URL,
    );
    expect(promptOnly.shouldDump).toBe(false);
  });

  it('does not intercept non-LLM URLs', () => {
    const result = gates.resolveFetchGates(
      { CLAWX_PROMPT_OPTIMIZATION_ENABLED: '1' },
      'https://api.example.com/v1/models',
    );
    expect(result.shouldIntercept).toBe(false);
  });

  it('resolveRequestUrl handles string, URL, and Request-like objects', () => {
    expect(gates.resolveRequestUrl('https://api.example.com/v1/messages')).toBe(
      'https://api.example.com/v1/messages',
    );
    expect(gates.resolveRequestUrl(new URL('https://api.example.com/v1/responses'))).toBe(
      'https://api.example.com/v1/responses',
    );
    expect(gates.resolveRequestUrl({ url: 'https://api.example.com/v1/chat/completions' })).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  const openclawDistDir = join(process.cwd(), 'node_modules', 'openclaw', 'dist');
  const hasUndiciRuntime =
    existsSync(openclawDistDir) &&
    readdirSync(openclawDistDir).some((f) => /^undici-runtime-.*\.js$/.test(f));
  it.skipIf(!hasUndiciRuntime)(
    'resolveOpenClawUndiciFromDist resolves undici via dist/undici-runtime-*.js',
    () => {
      const resolved = gates.resolveOpenClawUndiciFromDist(
        join(process.cwd(), 'node_modules', 'openclaw'),
      );
      expect(resolved).not.toBeNull();
      expect(resolved?.resolvedPath).toContain('undici');
      expect(typeof resolved?.undici.fetch).toBe('function');
    },
  );

  it('resolveOpenClawUndiciFromDist returns null when dist is missing', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openclaw-missing-'));
    expect(gates.resolveOpenClawUndiciFromDist(cwd)).toBeNull();
  });

  it('resolveOpenClawUndiciFromDist works with a minimal openclaw dist fixture', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'openclaw-fixture-'));
    const distDir = join(cwd, 'dist');
    const undiciDir = join(cwd, 'node_modules', 'undici');
    mkdirSync(distDir, { recursive: true });
    mkdirSync(undiciDir, { recursive: true });
    writeFileSync(join(undiciDir, 'package.json'), JSON.stringify({ name: 'undici', main: 'index.js' }));
    writeFileSync(
      join(undiciDir, 'index.js'),
      `module.exports = {
  fetch: function nativeFetch() { return Promise.resolve(new Response('ok')); },
  Agent: class Agent {},
  EnvHttpProxyAgent: class EnvHttpProxyAgent {},
  FormData: class FormData {},
  ProxyAgent: class ProxyAgent {},
};`,
    );
    writeFileSync(join(distDir, 'undici-runtime-test.js'), 'module.exports = {};');
    const resolved = gates.resolveOpenClawUndiciFromDist(cwd);
    expect(resolved).not.toBeNull();
    expect(resolved?.resolvedPath).toContain('undici');
  });

  it('resolveActiveRunFilePath points under ~/.openclaw/logs/prompt_optimization', () => {
    const filePath = gates.resolveActiveRunFilePath();
    expect(filePath).toContain('prompt_optimization');
    expect(filePath.endsWith('active_run.json')).toBe(true);
  });
});
