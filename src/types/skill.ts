/**
 * Skill Type Definitions
 * Types for skills/plugins
 */

/**
 * Skill data structure
 */
export interface Skill {
  id: string;
  slug?: string;
  name: string;
  description: string;
  enabled: boolean;
  icon?: string;
  version?: string;
  author?: string;
  configurable?: boolean;
  config?: Record<string, unknown>;
  customUiSchema?: unknown; // Parsed settings.ui.json schema
  isCore?: boolean;
  isBundled?: boolean;
  dependencies?: string[];
  source?: string;
  baseDir?: string;
  filePath?: string;
  marketplace?: {
    provider: string;
    slug?: string;
    installedVersion?: string;
    versionBase?: string;
    category?: string;
    archiveHash?: string;
    listingRevision?: string;
    installedAt?: string;
    manifestPath?: string;
    originPath?: string;
  };
  agents?: string[]; // List of agent IDs this skill is assigned to (computed from AgentListEntry.skills)
}

export interface QuickAccessSkill {
  name: string;
  description: string;
  source: 'workspace' | 'openclaw' | 'agents' | 'legacy';
  sourceLabel: string;
  manifestPath: string;
  baseDir: string;
  /** True when this SKILL.md is workflow-shaped (frontmatter opt-in or body heuristic). */
  workflow?: boolean;
  /** Ordered step titles parsed from the SKILL.md body (only when `workflow`). */
  workflowSteps?: { title: string }[];
  /** Human-friendly card title (SKILL.md H1 / frontmatter name), when `workflow`. */
  workflowTitle?: string;
}

/**
 * Skill bundle (preset skill collection)
 */
export interface SkillBundle {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  descriptionZh: string;
  icon: string;
  skills: string[];
  recommended?: boolean;
}


/**
 * Marketplace skill data
 */
export interface MarketplaceSkill {
  slug: string;
  name: string;
  description: string;
  version: string;
  versionBase?: string;
  author?: string;
  category?: string;
  archiveHash?: string;
  listingRevision?: string;
  downloads?: number;
  stars?: number;
}

/**
 * Skill row from the remote skills marketplace HTTP API (server-managed catalog).
 * Same shape as {@link MarketplaceSkill}; kept as a named alias for clarity.
 */
export type ServerMarketplaceSkill = MarketplaceSkill;

/**
 * Skill configuration schema
 */
export interface SkillConfigSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array';
    title?: string;
    description?: string;
    default?: unknown;
    enum?: unknown[];
  }>;
  required?: string[];
}
