import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OfficeStructuredWorkflowPanelProps {
  stepDrafts: ReactNode;
  preview: ReactNode;
  className?: string;
}

/** 结构化编排：节点表 + 流程预览统一容器，减少嵌套边框并控制纵向高度。 */
export function OfficeStructuredWorkflowPanel({
  stepDrafts,
  preview,
  className,
}: OfficeStructuredWorkflowPanelProps) {
  const { t } = useTranslation('office');

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border/50 bg-muted/10 shadow-sm',
        className,
      )}
      data-testid="office-structured-workflow-panel"
    >
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted/20 px-4 py-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <GitBranch className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="font-serif text-sm font-normal tracking-tight text-foreground">
            {t('taskForm.structuredWorkflowPanelTitle')}
          </p>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('taskForm.structuredWorkflowPanelHint')}
          </p>
        </div>
      </div>
      <div className="space-y-0 divide-y divide-border/30">
        <div className="px-4 py-4">{stepDrafts}</div>
        <div className="office-form-scroll-section bg-muted/5 px-4 py-3">{preview}</div>
      </div>
    </div>
  );
}
