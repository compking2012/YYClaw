import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SkillAllowlistPicker } from '@/components/skills/SkillAllowlistPicker';
import { SkillPickerDialogShell } from '@/components/skills/SkillPickerDialogShell';
import { useAgentsStore } from '@/stores/agents';
import { useSkillsStore } from '@/stores/skills';
import { toast } from '@/lib/toast';
import type { Skill } from '@/types/skill';
import {
  agentSkillsSelectionChanged,
  normalizeSkillsSelectionForPersist,
  resolveAgentSkillSelection,
} from '@/lib/skill-lookup-aliases';

export function GlobalSkillsDialog({
  availableSkills,
  isOpen,
  onClose,
}: {
  availableSkills: Skill[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation('skills');
  const { defaultAgentSkills, updateGlobalAgentSkills } = useAgentsStore();
  const fetchSkills = useSkillsStore((state) => state.fetchSkills);
  const fetchAgents = useAgentsStore((state) => state.fetchAgents);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedSkills(resolveAgentSkillSelection(defaultAgentSkills, availableSkills));
  }, [availableSkills, defaultAgentSkills, isOpen]);

  const hasChanges = agentSkillsSelectionChanged(
    selectedSkills,
    defaultAgentSkills,
    availableSkills,
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateGlobalAgentSkills(
        normalizeSkillsSelectionForPersist(selectedSkills, availableSkills),
      );
      await Promise.all([fetchSkills(), fetchAgents()]);
      toast.success(t('globalSkills.saved'));
      onClose();
    } catch (error) {
      toast.error(t('globalSkills.saveFailed', { error: String(error) }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SkillPickerDialogShell
      open={isOpen}
      onClose={onClose}
      title={t('globalSkills.title')}
      subtitle={t('globalSkills.subtitle')}
      onSave={() => void handleSave()}
      saving={saving}
      saveDisabled={!hasChanges}
      saveTestId="global-skills-save"
      closeTestId="global-skills-exit"
      testId="global-skills-dialog"
    >
      <SkillAllowlistPicker
        availableSkills={availableSkills}
        selectedSkills={selectedSkills}
        onChange={setSelectedSkills}
        title={t('globalSkills.pickerTitle')}
        description={t('globalSkills.pickerDescription')}
        searchPlaceholder={t('agents:skills.searchPlaceholder')}
        emptyText={t('agents:skills.empty')}
        testIdPrefix="global-skills"
        pageSectionLayout
        sessionKey={isOpen ? 'global-skills' : null}
        initialSelectedSkills={resolveAgentSkillSelection(defaultAgentSkills, availableSkills)}
      />
    </SkillPickerDialogShell>
  );
}
