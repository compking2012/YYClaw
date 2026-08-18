import { cn } from '@/lib/utils';

/** Office 新建/编辑表单项统一输入框样式（与「功能描述」一致） */
export const OFFICE_FORM_FIELD_CLASS = 'w-full border-border/60 bg-surface-input/40';

export function officeFormFieldClass(className?: string): string {
  return cn(OFFICE_FORM_FIELD_CLASS, className);
}
