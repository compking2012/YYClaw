import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_MANIFEST_DEPTH = 6;
const MAX_MANIFEST_DIRS = 2_000;

export function findSkillManifestPathSync(skillDir: string): string | null {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: skillDir, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < MAX_MANIFEST_DIRS) {
    const current = queue.shift()!;
    visited += 1;
    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const manifest = entries.find(
      (entry) => entry.isFile() && entry.name.toLowerCase() === 'skill.md',
    );
    if (manifest) return join(current.dir, manifest.name);
    if (current.depth >= MAX_MANIFEST_DEPTH) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return null;
}

export function readSkillManifestCanonicalName(skillDir: string): string {
  try {
    const manifestPath = findSkillManifestPathSync(skillDir);
    if (!manifestPath) return '';
    const raw = readFileSync(manifestPath, 'utf8');
    const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
    return frontmatter?.[1].match(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/m)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}
