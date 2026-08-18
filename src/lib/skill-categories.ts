// Skill Store categories. Keep the ids in sync with the server-side taxonomy
// (yyclawmanager `SKILL_CATEGORIES`); labels are localized via i18n keys
// under `publishMeta.categoryOptions.<id>`.
export const SKILL_CATEGORY_IDS = [
  'office-efficiency',
  'hardware-rd',
  'software-rd',
  'it-ops-security',
  'knowledge-management',
  'content-creation',
  'data-analysis',
  'ops-admin',
  'marketing-commercial',
  'other',
] as const;

export type SkillCategoryId = (typeof SKILL_CATEGORY_IDS)[number];

export const DEFAULT_SKILL_CATEGORY: SkillCategoryId = 'other';

export function normalizeSkillCategory(id?: string | null): SkillCategoryId {
  const normalized = String(id || '').trim() as SkillCategoryId;
  return SKILL_CATEGORY_IDS.includes(normalized) ? normalized : DEFAULT_SKILL_CATEGORY;
}

export function skillCategoryI18nKey(id?: string | null): string {
  return `publishMeta.categoryOptions.${normalizeSkillCategory(id)}`;
}

export function matchesSkillBrowseCategory(category: string | undefined | null, browseCategory: string): boolean {
  if (!browseCategory || browseCategory === 'all') return true;
  return normalizeSkillCategory(category) === browseCategory;
}
