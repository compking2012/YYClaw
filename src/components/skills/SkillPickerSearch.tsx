import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { skillPickerInputClasses } from '@/components/skills/skill-picker-styles';
import { cn } from '@/lib/utils';

export function SkillPickerSearch({
  value,
  onChange,
  placeholder,
  testId,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      <Input
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(skillPickerInputClasses, 'pl-9 pr-9')}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
