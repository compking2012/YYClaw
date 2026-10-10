import { access } from 'node:fs/promises';
import path from 'node:path';
import { selectSteps, PROFILES } from './profiles.mjs';
import { toArray } from './specs.mjs';
import { touchesCommunicationPath } from './rules.mjs';

export const SAFE_SCRIPTS = new Set(['lint:check', 'typecheck', 'build:vite', 'harness:ci', 'comms:replay', 'comms:compare', 'test:e2e', 'screenshots', 'perf:chat']);

export function requiredTestStep(value) {
  if (typeof value !== 'string' || /[;&|`$<>\n\r]/.test(value)) throw new Error(`Unsafe required test: ${value}`);
  const tokens = (value.trim().match(/"[^"\n]*"|'[^'\n]*'|[^\s]+/g) ?? []).map((token) => /^['"]/.test(token) ? token.slice(1, -1) : token);
  const testPath = (token) => /^(tests\/(unit|e2e)\/|electron\/)[\w./-]+\.(test|spec)\.[cm]?[jt]sx?$/.test(token) && !token.includes('..');
  const isFile = tokens.every(testPath);
  if (isFile) {
    const e2e = tokens.every((token) => token.startsWith('tests/e2e/'));
    return { name: value, profile: 'targeted', command: 'pnpm', args: ['exec', e2e ? 'playwright' : 'vitest', e2e ? 'test' : 'run', ...tokens] };
  }
  if (tokens[0] !== 'pnpm') throw new Error(`Unregistered required test: ${value}`);
  if (tokens[1] === 'run' && tokens.length === 3 && SAFE_SCRIPTS.has(tokens[2])) return { name: value, profile: 'targeted', command: 'pnpm', args: tokens.slice(1) };
  if (tokens[1] === 'test' && tokens.length === 2) return { name: value, profile: 'targeted', command: 'pnpm', args: ['test'] };
  if (['typecheck', 'lint:check'].includes(tokens[1]) && tokens.length === 2) return { name: value, profile: 'targeted', command: 'pnpm', args: ['run', tokens[1]] };
  if (tokens[1] === 'exec' && ['vitest', 'playwright'].includes(tokens[2]) && tokens[3] === (tokens[2] === 'vitest' ? 'run' : 'test')) {
    const files = [];
    let valid = true;
    for (let index = 4; index < tokens.length; index++) {
      const token = tokens[index];
      if (/^--(workers|maxWorkers)=\d+$/.test(token) || /^--project=(parallel|exclusive|performance)$/.test(token)) continue;
      if (token === '--grep' && tokens[index + 1]) { index++; continue; }
      if (/^tests\/(unit|e2e)\/[\w./-]+\.[jt]sx?$/.test(token) && !token.includes('..')) files.push(token);
      else valid = false;
    }
    if (valid && files.length) return { name: value, profile: 'targeted', command: 'pnpm', args: tokens.slice(1) };
  }
  if (tokens[1] === 'exec' && tokens[2] === 'eslint' && tokens.length > 3 && tokens.slice(3).every((file) => /^(src|tests|electron|shared)\/[\w./-]+\.[jt]sx?$/.test(file) && !file.includes('..'))) return { name: value, profile: 'targeted', command: 'pnpm', args: tokens.slice(1) };
  if (tokens.join(' ') === 'pnpm exec vite build --sourcemap') return { name: value, profile: 'targeted', command: 'pnpm', args: tokens.slice(1) };
  if (tokens[1] === 'harness' && ['validate', 'run'].includes(tokens[2]) && tokens[3] === '--spec' && /^harness\/specs\/[\w/-]+\.md$/.test(tokens[4] ?? '') && !tokens[4].includes('..')) {
    const trailing = tokens.slice(5);
    if (trailing.every((token) => ['--dry-run', '--since', 'HEAD'].includes(token)) && (tokens[2] !== 'run' || trailing.includes('--dry-run'))) return { name: value, profile: 'targeted', command: 'pnpm', args: tokens.slice(1) };
  }
  throw new Error(`Unregistered required test: ${value}`);
}

export async function validationSteps(spec, scenario, changedFiles = [], root) {
  const profiles = new Set([...toArray(scenario?.data?.requiredProfiles), ...toArray(spec.data?.requiredProfiles)]);
  const tags = new Set(toArray(spec.data?.changeTags));
  if (touchesCommunicationPath(changedFiles) || tags.has('comms')) profiles.add('comms');
  if (changedFiles.some((file) => /^src\/(pages|components)\//.test(file)) || tags.has('ui')) profiles.add('e2e');
  if (tags.has('performance')) profiles.add('e2e');
  for (const profile of profiles) if (!PROFILES[profile]) throw new Error(`Unknown required profile: ${profile}`);
  const targeted = toArray(spec.data?.requiredTests).map(requiredTestStep);
  if (root) for (const step of targeted) for (const file of step.args.filter((arg) => /^(tests|electron)\//.test(arg))) await access(path.join(root, file));
  const seen = new Set();
  return [...targeted, ...selectSteps([...profiles])].filter((step) => {
    const key = JSON.stringify([step.command, step.args]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
