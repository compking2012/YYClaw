import { create } from 'zustand';
import { fetchQuickAccessSkills } from '@/lib/quick-access-skills';
import type { QuickAccessSkill } from '@/types/skill';

export interface WorkflowSkillMeta {
  workflow: boolean;
  workflowSteps?: { title: string }[];
  /** SKILL.md absolute path — used to attribute an implicit `Read` to a skill. */
  manifestPath?: string;
  /** Human-friendly card title. */
  title?: string;
  /** Original-cased skill name (the cache key below is normalized/lowercased). */
  name?: string;
  /** SKILL.md description — used to let the server decide skill-vs-generic-workflow relevance. */
  description?: string;
}

interface SkillWorkflowState {
  /** Cached workflow-shape metadata keyed by normalized skill name. */
  byName: Record<string, WorkflowSkillMeta>;
  loadedForAgentDir: string | null;
  /** Look up a skill's workflow metadata by name (case-insensitive). */
  getWorkflowSkill: (name: string) => WorkflowSkillMeta | undefined;
  /**
   * Resolve a workflow skill from a file path the agent `Read` (implicit use):
   * exact SKILL.md manifest match, else `…/<name>/SKILL.md` basename lookup.
   */
  getWorkflowSkillByReadPath: (path: string) => (WorkflowSkillMeta & { name: string }) | undefined;
  /** All cached workflow-shaped skills, for the dynamic-workflow generator's skill-match prompt. */
  listWorkflowSkills: () => Array<{ name: string; description?: string }>;
  /** Merge a fetched skill list into the cache. */
  ingest: (skills: QuickAccessSkill[]) => void;
  /** Fetch quick-access skills for an agent and cache their workflow metadata. */
  refresh: (input: { workspace?: string; agentDir?: string }) => Promise<void>;
}

function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase();
}

/** The immediate parent directory name of a file path, or null. */
function parentDirName(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] ?? null : null;
}

export const useSkillWorkflowStore = create<SkillWorkflowState>((set, get) => ({
  byName: {},
  loadedForAgentDir: null,

  getWorkflowSkill: (name: string) => {
    const key = normalizeName(name);
    if (!key) return undefined;
    return get().byName[key];
  },

  getWorkflowSkillByReadPath: (path: string) => {
    if (!path) return undefined;
    const normalized = path.trim().replace(/\\/g, '/');
    // Only consider markdown reads (the model loads a skill by reading its .md).
    if (!/\.md$/i.test(normalized)) return undefined;
    const entries = get().byName;
    // 1) exact manifestPath match (the SKILL.md).
    for (const [name, meta] of Object.entries(entries)) {
      if (meta.manifestPath && meta.manifestPath.replace(/\\/g, '/') === normalized) {
        return { ...meta, name };
      }
    }
    // 2) fallback: the file's immediate parent dir name matches a known skill
    //    (handles `…/<name>/SKILL.md` and other `.md` files under the skill dir,
    //    robust to symlink vs realpath root differences between openclaw's
    //    injected `location` and our scanned manifestPath).
    const dirName = parentDirName(normalized);
    if (dirName) {
      const meta = entries[normalizeName(dirName)];
      if (meta) return { ...meta, name: dirName };
    }
    return undefined;
  },

  listWorkflowSkills: () => {
    const entries = Object.values(get().byName).filter((meta) => meta.workflow && meta.name);
    return entries.map((meta) => ({ name: meta.name!, description: meta.description }));
  },

  ingest: (skills: QuickAccessSkill[]) => {
    if (!skills.length) return;
    set((s) => {
      const next = { ...s.byName };
      for (const skill of skills) {
        const key = normalizeName(skill.name);
        if (!key) continue;
        next[key] = {
          workflow: !!skill.workflow,
          workflowSteps: skill.workflowSteps,
          manifestPath: skill.manifestPath,
          title: skill.workflowTitle || skill.name,
          name: skill.name,
          description: skill.description,
        };
      }
      return { byName: next };
    });
  },

  refresh: async (input) => {
    try {
      const result = await fetchQuickAccessSkills(input);
      if (result.success && result.skills) {
        get().ingest(result.skills);
        set({ loadedForAgentDir: input.agentDir ?? null });
      }
    } catch {
      // Cache is best-effort; a miss just means no observed-workflow card.
    }
  },
}));
