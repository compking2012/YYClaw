export type SkillInstallSheetMode = 'install' | 'version';
export type SkillServerInstallAction = 'install' | 'upgrade' | 'rollback' | 'uninstall';

/**
 * Upgrade/rollback (and the version-mode sheet) already imply replacing the
 * installed skill — skip the SAME_NAME_EXISTS confirm dialog.
 */
export function shouldAutoOverwriteSameNameInstall(
  action: SkillServerInstallAction,
  sheetMode: SkillInstallSheetMode,
): boolean {
  return action === 'upgrade' || action === 'rollback' || sheetMode === 'version';
}
