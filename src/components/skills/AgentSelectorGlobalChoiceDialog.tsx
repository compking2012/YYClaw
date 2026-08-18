import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS,
  SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS,
} from '@/components/skills/skill-picker-styles';
import { cn } from '@/lib/utils';
import type {
  AgentSelectorGlobalChoice,
  AgentSelectorGlobalPromptKind,
} from '@/lib/agent-selector-draft';

export function AgentSelectorGlobalChoiceDialog({
  open,
  skillName,
  kind,
  onChoice,
}: {
  open: boolean;
  skillName: string;
  kind: AgentSelectorGlobalPromptKind | null;
  onChoice: (choice: AgentSelectorGlobalChoice) => void;
}) {
  const { t } = useTranslation('skills');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isPromote = kind === 'promote-to-global';

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onChoice('cancel')}>
      <DialogContent
        overlayClassName={SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS}
        className={cn(SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS, 'w-[calc(100%-2rem)] max-w-md rounded-lg border bg-background p-6 shadow-lg')}
        data-testid="skill-agent-global-choice-dialog"
        data-kind={kind ?? undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogTitle className="text-lg font-semibold">
          {isPromote
            ? t('agentSelector.globalPrompt.promoteTitle', { defaultValue: 'Set as global?' })
            : t('agentSelector.globalPrompt.demoteTitle', { defaultValue: 'Remove from global?' })}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {isPromote
            ? t('agentSelector.globalPrompt.promoteMessage', {
              skillName,
              defaultValue: 'All agents selected for "{{skillName}}". Draft only — save to apply.',
            })
            : t('agentSelector.globalPrompt.demoteMessage', {
              skillName,
              defaultValue: 'No agents selected for "{{skillName}}". Draft only — save to apply.',
            })}
        </DialogDescription>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            onClick={() => onChoice('cancel')}
            data-testid="skill-agent-global-choice-cancel"
          >
            {t('agentSelector.globalPrompt.cancel', { defaultValue: 'Cancel' })}
          </Button>
          {isPromote ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onChoice('assign-only')}
                data-testid="skill-agent-global-choice-assign-only"
              >
                {t('agentSelector.globalPrompt.assignOnly', { defaultValue: 'Assign only' })}
              </Button>
              <Button
                type="button"
                onClick={() => onChoice('set-global')}
                data-testid="skill-agent-global-choice-set-global"
              >
                {t('agentSelector.globalPrompt.setGlobal', { defaultValue: 'Set as global' })}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onChoice('keep-global-opt-out')}
                data-testid="skill-agent-global-choice-keep-global"
              >
                {t('agentSelector.globalPrompt.keepGlobalOptOut', { defaultValue: 'Keep global' })}
              </Button>
              <Button
                type="button"
                onClick={() => onChoice('remove-global')}
                data-testid="skill-agent-global-choice-remove-global"
              >
                {t('agentSelector.globalPrompt.removeGlobal', { defaultValue: 'Remove global' })}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
