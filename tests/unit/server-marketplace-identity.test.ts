// @vitest-environment node
import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';
import {
  readServerSkillArchiveIdentity,
} from '@electron/services/skills-marketplace-client';

describe('server marketplace archive identity', () => {
  it('uses the actual SKILL.md name before catalog identity', () => {
    const zip = new AdmZip();
    zip.addFile(
      'nested/SKILL.md',
      Buffer.from('---\nname: Shared Canonical Name\ndescription: test\n---\n'),
    );
    zip.addFile(
      'nested/manifest.json',
      Buffer.from(JSON.stringify({ slug: 'manifest-slug' })),
    );
    expect(zip.getEntries().map((entry) => entry.entryName)).toEqual([
      'nested/SKILL.md',
      'nested/manifest.json',
    ]);

    const buffer = zip.toBuffer();
    expect(buffer.length).toBeGreaterThan(0);
    expect(new AdmZip(buffer).getEntries().map((entry) => entry.entryName)).toEqual(
      expect.arrayContaining(['nested/SKILL.md', 'nested/manifest.json']),
    );
    expect(readServerSkillArchiveIdentity(buffer, 'catalog-slug')).toEqual({
      canonicalName: 'Shared Canonical Name',
      aliases: expect.arrayContaining([
        'Shared Canonical Name',
        'catalog-slug',
        'manifest-slug',
      ]),
    });
  });

  it('rejects archives without a SKILL.md before managed files are changed', () => {
    const zip = new AdmZip();
    zip.addFile('README.md', Buffer.from('# Not a skill\n'));

    expect(() => readServerSkillArchiveIdentity(zip.toBuffer(), 'catalog-slug')).toThrow(
      'SKILLS_MARKETPLACE_EMPTY_ZIP',
    );
  });

  it('rejects ambiguous archives with multiple skill manifests', () => {
    const zip = new AdmZip();
    zip.addFile('first/SKILL.md', Buffer.from('---\nname: First\n---\n'));
    zip.addFile('second/SKILL.md', Buffer.from('---\nname: Second\n---\n'));

    expect(() => readServerSkillArchiveIdentity(zip.toBuffer(), 'catalog-slug')).toThrow(
      'SKILLS_MARKETPLACE_AMBIGUOUS_SKILL_ARCHIVE',
    );
  });

});
