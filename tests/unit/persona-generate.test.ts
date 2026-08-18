import { describe, it, expect } from 'vitest';
import {
  buildPersonaGenPrompt,
  isPersonaGeneratableFile,
  PERSONA_GEN_SET,
} from '@/lib/persona-generate';

describe('persona-generate', () => {
  it('offers generation only for markdown files', () => {
    expect(isPersonaGeneratableFile('SOUL.md')).toBe(true);
    expect(isPersonaGeneratableFile('IDENTITY.MD')).toBe(true);
    expect(isPersonaGeneratableFile('memory/note.md')).toBe(true);
    expect(isPersonaGeneratableFile('avatar.png')).toBe(false);
    expect(isPersonaGeneratableFile('config.json')).toBe(false);
  });

  it('the whole-set covers the identity-defining files', () => {
    expect([...PERSONA_GEN_SET]).toContain('IDENTITY.md');
    expect([...PERSONA_GEN_SET]).toContain('SOUL.md');
  });

  it('uses a file-type-aware system prompt and instructs raw markdown output', () => {
    const { system, input } = buildPersonaGenPrompt('SOUL.md', 'a calm, witty assistant');
    expect(system).toContain('SOUL.md');
    // Must forbid code fences / commentary so the result is saveable as-is.
    expect(system).toMatch(/code fences|Output ONLY/i);
    expect(input).toContain('a calm, witty assistant');
    // No existing content → fresh generation.
    expect(system).toContain('complete, ready-to-save');
  });

  it('uses current content as an editing baseline (extent driven by the request)', () => {
    const { system, input } = buildPersonaGenPrompt('IDENTITY.md', 'make it more playful', {
      currentContent: '# IDENTITY\n- Name: Ada',
    });
    // Neutral instruction: baseline is the current content, extent is up to the request.
    expect(system).toMatch(/baseline/i);
    expect(system).not.toMatch(/REWRITING/);
    expect(input).toContain('# IDENTITY');
    expect(input).toContain('make it more playful');
  });

  it('includes context files with a "do not output" constraint', () => {
    const { system, input } = buildPersonaGenPrompt('SOUL.md', 'tweak the tone', {
      currentContent: '# SOUL',
      contextFiles: [
        { name: 'IDENTITY.md', content: '# IDENTITY\n- Name: Ada' },
        { name: 'USER.md', content: '# USER\n- Prefers concise answers' },
      ],
    });
    expect(system).toMatch(/context.*consistency/i);
    expect(system).toMatch(/[Nn]ever output/);
    expect(input).toContain('IDENTITY.md');
    expect(input).toContain('USER.md');
    expect(input).toContain('Prefers concise answers');
  });

  it('truncates oversized context/current content to bound tokens', () => {
    const huge = 'x'.repeat(10_000);
    const { input } = buildPersonaGenPrompt('SOUL.md', 'refresh', {
      currentContent: huge,
      contextFiles: [{ name: 'IDENTITY.md', content: huge }],
    });
    expect(input).toContain('(truncated)');
    // Should not embed the full 10k-char blobs verbatim.
    expect(input).not.toContain(huge);
  });

  it('falls back to a generic spec for unknown files', () => {
    const { system } = buildPersonaGenPrompt('CUSTOM.md', 'anything');
    expect(system).toContain('CUSTOM.md');
    expect(system.length).toBeGreaterThan(0);
  });
});
