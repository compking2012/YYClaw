#!/usr/bin/env node
/**
 * Install deps, then download bundled uv + agent-browser + lark-cli.
 */
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', ['install']);

run('pnpm', ['run', 'uv:download']);
run('pnpm', ['run', 'agent-browser:download']);
run('pnpm', ['run', 'bundle:lark-cli']);

run('pnpm', ['run', 'cua-driver:download']);
