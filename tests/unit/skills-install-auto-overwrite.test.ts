import { describe, expect, it } from 'vitest';
import { shouldAutoOverwriteSameNameInstall } from '@/lib/skills-install-overwrite';

describe('shouldAutoOverwriteSameNameInstall', () => {
  it('auto-overwrites for upgrade and rollback without confirm', () => {
    expect(shouldAutoOverwriteSameNameInstall('upgrade', 'install')).toBe(true);
    expect(shouldAutoOverwriteSameNameInstall('rollback', 'install')).toBe(true);
  });

  it('auto-overwrites in version sheet mode even for install action', () => {
    expect(shouldAutoOverwriteSameNameInstall('install', 'version')).toBe(true);
  });

  it('requires confirm for fresh install in install mode', () => {
    expect(shouldAutoOverwriteSameNameInstall('install', 'install')).toBe(false);
    expect(shouldAutoOverwriteSameNameInstall('uninstall', 'install')).toBe(false);
  });
});
