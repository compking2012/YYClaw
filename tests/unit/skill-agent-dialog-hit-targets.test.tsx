/**
 * Suspects for skill-agent Save/Exit “no hit target” after local no-drag work:
 * 1) Nested GlobalChoice uses the same skill-picker z-index as the parent dialog,
 *    so parent content (z-111) paints above the nested overlay (z-110).
 * 2) Header Save/Exit rely on Button's disabled:pointer-events-none → disabled
 *    controls have no hit area (clicks fall through to parent chrome).
 * 3) DialogContent must opt out of Electron -webkit-app-region: drag (Win titlebar).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { SkillPickerDialogShell } from '@/components/skills/SkillPickerDialogShell';
import { SkillPickerDialogHeaderActions } from '@/components/skills/SkillPickerDialogHeaderActions';
import { AgentSelectorGlobalChoiceDialog } from '@/components/skills/AgentSelectorGlobalChoiceDialog';
import {
  SKILL_PICKER_MODAL_CONTENT_CLASS,
  SKILL_PICKER_MODAL_OVERLAY_CLASS,
  SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS,
  SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS,
  skillPickerHeaderActionButtonClasses,
} from '@/components/skills/skill-picker-styles';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('skill-agent dialog hit-target suspects', () => {
  it('DialogContent opts out of Electron drag regions', () => {
    render(
      <Dialog open>
        <DialogContent data-testid="sample-dialog">body</DialogContent>
      </Dialog>,
    );
    expect(screen.getByTestId('sample-dialog').className).toMatch(/\bno-drag\b/);
  });

  it('DialogOverlay opts out of Electron drag regions', () => {
    const { container } = render(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>,
    );
    const overlay = container.ownerDocument.querySelector('.clawx-dialog-overlay');
    expect(overlay?.className ?? '').toMatch(/\bno-drag\b/);
  });

  it('nested global-choice modal uses higher stacking than parent skill-picker modal', () => {
    // Same z-index for parent content (111) and nested overlay (110) lets parent
    // chrome sit above the nested dimmer — Save/Exit remain “visible but dead”.
    expect(SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS).not.toBe(SKILL_PICKER_MODAL_OVERLAY_CLASS);
    expect(SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS).not.toBe(SKILL_PICKER_MODAL_CONTENT_CLASS);

    render(
      <>
        <SkillPickerDialogShell
          open
          onClose={() => {}}
          title="Parent"
          onSave={() => {}}
          closeDisabled
          saveDisabled
          saveTestId="skill-agent-selector-save"
          closeTestId="skill-agent-selector-exit"
          testId="skill-agent-selector-dialog"
        >
          <div>parent body</div>
        </SkillPickerDialogShell>
        <AgentSelectorGlobalChoiceDialog
          open
          skillName="demo"
          kind="promote-to-global"
          onChoice={() => {}}
        />
      </>,
    );

    const parent = screen.getByTestId('skill-agent-selector-dialog');
    const nested = screen.getByTestId('skill-agent-global-choice-dialog');
    expect(parent.className).toContain(SKILL_PICKER_MODAL_CONTENT_CLASS);
    expect(nested.className).toContain(SKILL_PICKER_NESTED_MODAL_CONTENT_CLASS);

    const overlays = [...document.querySelectorAll('.clawx-dialog-overlay')].map(
      (node) => node.className,
    );
    expect(overlays.some((c) => c.includes(SKILL_PICKER_MODAL_OVERLAY_CLASS))).toBe(true);
    expect(overlays.some((c) => c.includes(SKILL_PICKER_NESTED_MODAL_OVERLAY_CLASS))).toBe(true);
  });

  it('disabled header Save/Exit keep a hit target (override Button pointer-events-none)', () => {
    expect(skillPickerHeaderActionButtonClasses).toMatch(/disabled:pointer-events-auto/);

    render(
      <Dialog open>
        <DialogContent>
          <SkillPickerDialogHeaderActions
            onSave={() => {}}
            onClose={() => {}}
            saveDisabled
            closeDisabled
            saveTestId="skill-agent-selector-save"
            closeTestId="skill-agent-selector-exit"
          />
        </DialogContent>
      </Dialog>,
    );

    const save = screen.getByTestId('skill-agent-selector-save');
    const exit = screen.getByTestId('skill-agent-selector-exit');
    expect(save).toBeDisabled();
    expect(exit).toBeDisabled();
    expect(save.className).toMatch(/disabled:pointer-events-auto/);
    expect(exit.className).toMatch(/disabled:pointer-events-auto/);
    expect(save.className).toMatch(/\bno-drag\b/);
    expect(exit.className).toMatch(/\bno-drag\b/);
  });
});
