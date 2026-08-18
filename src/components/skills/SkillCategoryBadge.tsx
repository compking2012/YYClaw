import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { normalizeSkillCategory, skillCategoryI18nKey } from '@/lib/skill-categories';

type SkillCategoryBadgeProps = {
  category?: string | null;
  className?: string;
};

export function SkillCategoryBadge({ category, className }: SkillCategoryBadgeProps) {
  const { t } = useTranslation('skills');
  const normalized = normalizeSkillCategory(category);
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
        className,
      )}
    >
      {t(skillCategoryI18nKey(normalized))}
    </span>
  );
}
