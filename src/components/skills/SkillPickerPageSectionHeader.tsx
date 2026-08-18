import {
  skillPickerPageSectionDescriptionClasses,
  skillPickerPageSectionTitleClasses,
} from '@/components/skills/skill-picker-styles';

export function SkillPickerPageSectionHeader({
  title,
  description,
  count,
}: {
  title: string;
  description?: string;
  count?: number;
}) {
  return (
    <div>
      <h3 className={skillPickerPageSectionTitleClasses}>
        {title}
        {count !== undefined ? ` (${count})` : ''}
      </h3>
      {description ? (
        <p className={skillPickerPageSectionDescriptionClasses}>{description}</p>
      ) : null}
    </div>
  );
}
