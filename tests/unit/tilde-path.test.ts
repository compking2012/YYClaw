import { describe, expect, it } from 'vitest';
import { compressPathToTilde } from '../../src/lib/tilde-path';

describe('compressPathToTilde', () => {
  it('compresses an absolute path under the home dir to a tilde prefix', () => {
    const home = process.env.HOME ?? '/Users/demo';
    const abs = `${home}/.openclaw/workspace-pm/projects/demo/index.html`;
    expect(compressPathToTilde(abs)).toBe(
      '~/.openclaw/workspace-pm/projects/demo/index.html',
    );
  });

  it('collapses the home dir itself to `~`', () => {
    const home = process.env.HOME ?? '/Users/demo';
    expect(compressPathToTilde(home)).toBe('~');
  });

  it('leaves already-compressed and outside-home paths alone', () => {
    expect(compressPathToTilde('~/.openclaw/a.txt')).toBe('~/.openclaw/a.txt');
    expect(compressPathToTilde('/tmp/a.txt')).toBe('/tmp/a.txt');
  });

  it('trims input and passes empty values through', () => {
    expect(compressPathToTilde('   ')).toBe('');
    expect(compressPathToTilde('  /tmp/a.txt  ')).toBe('/tmp/a.txt');
  });
});
