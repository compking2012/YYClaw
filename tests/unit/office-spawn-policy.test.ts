import { describe, it, expect, vi, beforeEach } from 'vitest';

const { writeOpenClawConfig, readOpenClawConfig } = vi.hoisted(() => ({
  writeOpenClawConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig,
  writeOpenClawConfig,
}));

vi.mock('@electron/services/office/store', () => ({
  listFixedGroups: vi.fn(),
  listTempProjects: vi.fn(),
}));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  rebuildOfficeSpawnPolicyRefsFromStore: vi.fn().mockResolvedValue(undefined),
}));

import {
  mergeOfficeSpawnToolDeny,
  stripOfficeSpawnToolDeny,
  refreshOfficeSpawnToolPolicy,
  withOfficeSpawnToolDeny,
  assertOfficeSpawnRpcDisabled,
  OFFICE_SPAWN_TOOL_DENY,
} from '@electron/services/office/office-spawn-policy';
import { rebuildOfficeSpawnPolicyRefsFromStore } from '@electron/services/office/office-spawn-policy-reconcile';

describe('office-spawn-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mergeOfficeSpawnToolDeny removes spawn tools from allow and adds deny', () => {
    const merged = mergeOfficeSpawnToolDeny({
      allow: ['read', 'sessions_spawn', 'subagents'],
    });
    expect(merged.allow).toEqual(['read']);
    expect(merged.deny).toEqual([...OFFICE_SPAWN_TOOL_DENY]);
  });

  it('stripOfficeSpawnToolDeny removes only Office spawn deny entries', () => {
    const stripped = stripOfficeSpawnToolDeny({
      deny: ['sessions_spawn', 'subagents', 'sessions_yield', 'exec'],
    });
    expect(stripped.deny).toEqual(['exec']);
  });

  it('refreshOfficeSpawnToolPolicy delegates to rebuildOfficeSpawnPolicyRefsFromStore', async () => {
    await refreshOfficeSpawnToolPolicy();
    expect(rebuildOfficeSpawnPolicyRefsFromStore).toHaveBeenCalledOnce();
  });

  it('withOfficeSpawnToolDeny does not write openclaw.json', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withOfficeSpawnToolDeny('main', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('withOfficeSpawnToolDeny is no-op for agents outside Office', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withOfficeSpawnToolDeny('other-agent', fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('assertOfficeSpawnRpcDisabled throws for Office RPC spawn', () => {
    expect(() => assertOfficeSpawnRpcDisabled()).toThrow(/Office 场景已禁用 subagent spawn/);
  });
});
