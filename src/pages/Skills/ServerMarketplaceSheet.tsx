/**
 * Install skills from the server catalog or from ClawHub (CLI explore/search), switchable via source dropdown.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Search, X, AlertCircle, Package, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SkillSideSheetShell } from '@/components/skills/SkillSideSheetShell';
import { SkillCategoryBadge } from '@/components/skills/SkillCategoryBadge';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import {
  SKILL_PICKER_MODAL_CONTENT_CLASS,
  SKILL_PICKER_MODAL_OVERLAY_CLASS,
} from '@/components/skills/skill-picker-styles';
import { hostApi } from '@/lib/host-api';
import { cn } from '@/lib/utils';
import { SKILL_CATEGORY_IDS, matchesSkillBrowseCategory, skillCategoryI18nKey } from '@/lib/skill-categories';
import { useSkillsStore } from '@/stores/skills';
import { useSkillsMarketplaceStore } from '@/stores/skills-marketplace';
import type { Skill, ServerMarketplaceSkill } from '@/types/skill';
import { useTranslation } from 'react-i18next';
import { toast } from '@/lib/toast';
import { shouldAutoOverwriteSameNameInstall } from '@/lib/skills-install-overwrite';
import pkg from '../../../package.json';

export type InstallSkillSource = 'server' | 'clawhub';
export type ServerMarketplaceSheetMode = 'install' | 'version';

export type ServerMarketplaceSheetProps = {
  onClose: () => void;
  safeSkills: Skill[];
  skillsDirPath: string;
  /** When the sheet opens, default the source dropdown (default: server). */
  defaultInstallSource?: InstallSkillSource;
  /** Bump to refetch server catalog while the sheet is open. */
  catalogRefreshTrigger?: number;
  /** install = install/uninstall only; version = upgrade/rollback only. */
  mode?: ServerMarketplaceSheetMode;
};

type ServerMarketplaceListItem = ServerMarketplaceSkill & {
  localOnly?: boolean;
};

type ServerInstallAction = 'install' | 'upgrade' | 'rollback' | 'uninstall';

function normalizeSkillIdentity(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function inferVersionBase(value?: string): string {
  const normalized = normalizeSkillIdentity(value);
  const match = normalized.match(/^(.+)-\d+_\d+_\d+$/);
  return match?.[1] || normalized;
}

function basenameFromPath(value?: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function versionFromVersionedIdentifier(value?: string): string {
  const match = String(value || '').trim().match(/-(\d+)_(\d+)_(\d+)$/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : '';
}

function addSkillIdentityAlias(aliases: Set<string>, value?: string): void {
  const normalized = normalizeSkillIdentity(value);
  if (!normalized) return;
  aliases.add(normalized);
  aliases.add(inferVersionBase(normalized));
}

function remoteServerSkillAliases(remoteSkill: ServerMarketplaceSkill): Set<string> {
  const aliases = new Set<string>();
  addSkillIdentityAlias(aliases, remoteSkill.versionBase);
  addSkillIdentityAlias(aliases, remoteSkill.slug);
  addSkillIdentityAlias(aliases, remoteSkill.name);
  return aliases;
}

function localServerSkillAliases(localSkill: Skill): Set<string> {
  const aliases = new Set<string>();
  addSkillIdentityAlias(aliases, localSkill.marketplace?.versionBase);
  addSkillIdentityAlias(aliases, localSkill.marketplace?.slug);
  addSkillIdentityAlias(aliases, localSkill.slug);
  addSkillIdentityAlias(aliases, localSkill.id);
  addSkillIdentityAlias(aliases, localSkill.name);
  addSkillIdentityAlias(aliases, basenameFromPath(localSkill.baseDir));
  return aliases;
}

function isSameServerSkill(localSkill: Skill, remoteSkill: ServerMarketplaceSkill): boolean {
  if (localSkill.marketplace?.provider !== 'server') return false;
  const localAliases = localServerSkillAliases(localSkill);
  return [...remoteServerSkillAliases(remoteSkill)].some((alias) => localAliases.has(alias));
}

function compareVersionText(a?: string, b?: string): number | null {
  const parse = (value?: string): [number, number, number] | null => {
    const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function isSameSkillIdentity(localSkill: Skill, remoteSlug: string): boolean {
  return (
    localSkill.id === remoteSlug ||
    localSkill.slug === remoteSlug ||
    Boolean(localSkill.baseDir && (localSkill.baseDir.endsWith(`/${remoteSlug}`) || localSkill.baseDir.endsWith(`\\${remoteSlug}`)))
  );
}

function findInstalledServerMarketplaceSkill(
  localSkills: Skill[],
  remoteSkill: ServerMarketplaceSkill,
): Skill | undefined {
  return localSkills.find((localSkill) => isSameServerSkill(localSkill, remoteSkill));
}

function serverInstallAction(localSkill: Skill | undefined, remoteSkill: ServerMarketplaceSkill): ServerInstallAction {
  if (!localSkill) return 'install';
  const cmp = compareVersionText(installedVersionText(localSkill), remoteSkill.version);
  if (cmp != null) {
    if (cmp < 0) return 'upgrade';
    if (cmp === 0) return 'uninstall';
    return 'rollback';
  }
  const sameRevision = Boolean(remoteSkill.listingRevision) &&
    localSkill.marketplace?.listingRevision === remoteSkill.listingRevision;
  const sameHash = Boolean(remoteSkill.archiveHash) &&
    localSkill.marketplace?.archiveHash === remoteSkill.archiveHash;
  return sameRevision || sameHash || isSameSkillIdentity(localSkill, remoteSkill.slug) ? 'uninstall' : 'install';
}

function installedVersionText(localSkill?: Skill): string {
  return localSkill?.marketplace?.installedVersion ||
    localSkill?.version ||
    versionFromVersionedIdentifier(localSkill?.marketplace?.slug) ||
    versionFromVersionedIdentifier(localSkill?.slug) ||
    versionFromVersionedIdentifier(localSkill?.id) ||
    versionFromVersionedIdentifier(basenameFromPath(localSkill?.baseDir));
}

function localServerSkillMatchesQuery(localSkill: Skill, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [localSkill.id, localSkill.slug, localSkill.name, localSkill.description]
    .some((value) => String(value || '').toLowerCase().includes(q));
}

function mergeServerCatalogWithLocalInstalls(
  remoteSkills: ServerMarketplaceSkill[],
  localSkills: Skill[],
  query: string,
  browseCategory: string,
): ServerMarketplaceListItem[] {
  const merged: ServerMarketplaceListItem[] = remoteSkills.map((skill) => ({ ...skill }));
  const hasRemoteIdentity = (localSkill: Skill) =>
    remoteSkills.some((remoteSkill) => isSameServerSkill(localSkill, remoteSkill));

  for (const localSkill of localSkills) {
    if (localSkill.marketplace?.provider !== 'server') continue;
    if (hasRemoteIdentity(localSkill)) continue;
    if (!localServerSkillMatchesQuery(localSkill, query)) continue;
    if (!matchesSkillBrowseCategory(localSkill.marketplace.category, browseCategory)) continue;

    const slug = localSkill.marketplace.slug || localSkill.slug || localSkill.id;
    if (!slug) continue;
    merged.push({
      slug,
      name: localSkill.name || slug,
      description: localSkill.description || '',
      version: installedVersionText(localSkill),
      versionBase: localSkill.marketplace.versionBase || inferVersionBase(slug),
      category: localSkill.marketplace.category,
      archiveHash: localSkill.marketplace.archiveHash,
      listingRevision: localSkill.marketplace.listingRevision,
      localOnly: true,
    });
  }

  return merged.filter((skill) => matchesSkillBrowseCategory(skill.category, browseCategory));
}

export function ServerMarketplaceSheet({
  onClose,
  safeSkills,
  skillsDirPath,
  defaultInstallSource = 'server',
  catalogRefreshTrigger,
  mode = 'install',
}: ServerMarketplaceSheetProps) {
  const { t } = useTranslation('skills');
  const [installQuery, setInstallQuery] = useState('');
  const [installSource, setInstallSource] = useState<InstallSkillSource>(defaultInstallSource);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [detailSkill, setDetailSkill] = useState<ServerMarketplaceListItem | null>(null);
  const [confirmDialogState, setConfirmDialogState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  } | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirm = useCallback((options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
  }): Promise<boolean> => new Promise((resolve) => {
    confirmResolverRef.current = resolve;
    setConfirmDialogState(options);
  }), []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialogState(null);
    resolver?.(confirmed);
  }, []);

  const formatSkillIdList = useCallback((ids?: string[]) => {
    const cleaned = (ids || []).map((id) => String(id || '').trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.join(', ') : '—';
  }, []);

  const {
    marketplaceResults,
    marketplaceLoading,
    marketplaceError,
    fetchMarketplaceSkills,
    resetMarketplace,
  } = useSkillsMarketplaceStore();

  const {
    searchResults,
    searchSkills,
    searchError,
    searching,
    installSkill,
    installServerMarketplaceSkill,
    uninstallSkill,
    installing,
    fetchSkills,
  } = useSkillsStore();

  const handleClose = useCallback(() => {
    setInstallQuery('');
    setSelectedCategory('all');
    resetMarketplace();
    onClose();
  }, [onClose, resetMarketplace]);

  useEffect(() => {
    setInstallSource(defaultInstallSource);
  }, [defaultInstallSource]);

  useEffect(() => {
    if (mode === 'version') {
      queueMicrotask(() => setInstallSource('server'));
    }
  }, [mode]);

  useEffect(() => {
    const query = installQuery.trim();
    if (mode === 'version' || installSource === 'server') {
      if (query.length === 0) {
        void fetchMarketplaceSkills('', selectedCategory);
        return;
      }
      const timer = setTimeout(() => {
        void fetchMarketplaceSkills(query, selectedCategory);
      }, 300);
      return () => clearTimeout(timer);
    }

    if (query.length === 0) {
      void searchSkills('');
      return;
    }
    const timer = setTimeout(() => {
      void searchSkills(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [installQuery, installSource, mode, catalogRefreshTrigger, selectedCategory, fetchMarketplaceSkills, searchSkills]);

  const handleInstallSourceChange = (next: InstallSkillSource) => {
    if (next === installSource) return;
    setInstallSource(next);
    resetMarketplace();
  };

  const handleInstall = useCallback(
    async (slug: string) => {
      const serverSource = mode === 'version' || installSource === 'server';
      const runInstall = async (overwriteSameName?: boolean) => {
        if (serverSource) {
          const remoteSkill =
            marketplaceResults.find((skill) => skill.slug === slug) ||
            (detailSkill?.slug === slug ? detailSkill : undefined);
          await installServerMarketplaceSkill(
            slug,
            remoteSkill?.archiveHash,
            remoteSkill?.listingRevision,
            remoteSkill?.version,
            remoteSkill?.versionBase,
            remoteSkill?.category,
            overwriteSameName ? { overwriteSameName: true } : undefined,
          );
          return;
        }
        await installSkill(slug, undefined, overwriteSameName ? { overwriteSameName: true } : undefined);
      };

      try {
        let successAction: ServerInstallAction = 'install';
        let successName = slug;
        let successVersion = '';
        const remotePreview =
          serverSource
            ? (
              marketplaceResults.find((skill) => skill.slug === slug)
              || (detailSkill?.slug === slug ? detailSkill : undefined)
            )
            : undefined;
        if (serverSource && remotePreview) {
          successName = remotePreview.name || slug;
          successVersion = remotePreview.version || '';
          successAction = serverInstallAction(
            findInstalledServerMarketplaceSkill(safeSkills, remotePreview),
            remotePreview,
          );
        }

        // Version replace is intentional — skip SAME_NAME_EXISTS confirm.
        const autoOverwrite = shouldAutoOverwriteSameNameInstall(successAction, mode);
        try {
          await runInstall(autoOverwrite);
        } catch (err) {
          const sameNameErr = err as Error & { code?: string; displayName?: string; existingIds?: string[] };
          if (sameNameErr?.message === 'SAME_NAME_EXISTS' || sameNameErr?.code === 'SAME_NAME_EXISTS') {
            const proceed = await requestConfirm({
              title: t('installOverwrite.title'),
              message: t('installOverwrite.confirm', {
                name: sameNameErr.displayName || successName || slug,
                ids: formatSkillIdList(sameNameErr.existingIds),
              }),
              confirmLabel: t('confirmActions.confirm'),
              cancelLabel: t('confirmActions.cancel'),
            });
            if (!proceed) {
              toast.info(t('installOverwrite.cancelled'));
              return;
            }
            await runInstall(true);
          } else {
            throw err;
          }
        }

        await fetchSkills();
        if (successAction === 'upgrade') {
          toast.success(t('toast.upgradedVersion', { name: successName, version: successVersion || '—' }));
        } else if (successAction === 'rollback') {
          toast.success(t('toast.rolledBackVersion', { name: successName, version: successVersion || '—' }));
        } else {
          toast.success(t('toast.installed'));
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (['installTimeoutError', 'installRateLimitError'].includes(errorMessage)) {
          toast.error(t(`toast.${errorMessage}`, { path: skillsDirPath }), { duration: 10000 });
        } else if (serverSource) {
          let detail = errorMessage;
          if (errorMessage.includes('SKILLS_MARKETPLACE_INVALID_SKILL_NAME')) {
            detail = t('skillsMarketplace.installInvalidName');
          } else if (errorMessage.includes('SKILLS_MARKETPLACE_EMPTY_ZIP')) {
            detail = t('skillsMarketplace.installEmptyZip');
          } else if (errorMessage.includes('SKILLS_MARKETPLACE_NO_BASE_URL')) {
            detail = t('skillsMarketplace.configError');
          }
          toast.error(t('toast.failedInstall') + ': ' + detail);
        } else {
          toast.error(t('toast.failedInstall') + ': ' + errorMessage);
        }
      }
    },
    [
      installSource,
      mode,
      marketplaceResults,
      detailSkill,
      safeSkills,
      installSkill,
      installServerMarketplaceSkill,
      fetchSkills,
      t,
      skillsDirPath,
      requestConfirm,
      formatSkillIdList,
    ],
  );

  const handleUninstall = useCallback(
    async (slug: string, baseDir?: string) => {
      try {
        await uninstallSkill(slug, { baseDir });
        toast.success(t('toast.uninstalled'));
      } catch (err) {
        toast.error(t('toast.failedUninstall') + ': ' + String(err));
      }
    },
    [uninstallSkill, t],
  );

  const resolveServerErrorMessage = () => {
    if (!marketplaceError) return '';
    if (marketplaceError === 'marketplaceConfigError') {
      return t('skillsMarketplace.configError');
    }
    if (
      ['marketplaceFetchTimeoutError', 'marketplaceFetchRateLimitError', 'marketplaceFetchError'].includes(
        marketplaceError,
      )
    ) {
      return t(`skillsMarketplace.${marketplaceError}`);
    }
    return t('skillsMarketplace.searchError');
  };

  const resolveClawhubErrorMessage = () => {
    if (!searchError) return '';
    const key = searchError.replace('Error: ', '');
    if (['searchTimeoutError', 'searchRateLimitError', 'timeoutError', 'rateLimitError'].includes(key)) {
      return t(`toast.${key}`, { path: skillsDirPath });
    }
    return t('marketplace.searchError');
  };

  const effectiveInstallSource = mode === 'version' ? 'server' : installSource;
  const loading = effectiveInstallSource === 'server' ? marketplaceLoading : searching;
  const showServerError = effectiveInstallSource === 'server' && !!marketplaceError;
  const showClawhubError = effectiveInstallSource === 'clawhub' && !!searchError;
  const visibleServerSkills = useMemo<ServerMarketplaceListItem[]>(() => {
    if (mode === 'version') {
      const query = installQuery.trim();
      return marketplaceResults
        .map((skill) => ({ skill, installedSkill: findInstalledServerMarketplaceSkill(safeSkills, skill) }))
        .filter(({ skill, installedSkill }) => {
          if (!installedSkill) return false;
          const action = serverInstallAction(installedSkill, skill);
          return (action === 'upgrade' || action === 'rollback') && localServerSkillMatchesQuery(installedSkill, query);
        })
        .map(({ skill }) => ({ ...skill }));
    }
    return mergeServerCatalogWithLocalInstalls(marketplaceResults, safeSkills, installQuery, selectedCategory);
  }, [marketplaceResults, safeSkills, installQuery, selectedCategory, mode]);

  const dialogTitle =
    mode === 'version'
      ? t('skillsMarketplace.versionDialogTitle')
      : installSource === 'server'
        ? t('skillsMarketplace.installDialogTitle')
        : t('marketplace.installDialogTitle');
  const dialogSubtitle =
    mode === 'version'
      ? t('skillsMarketplace.versionDialogSubtitle')
      : installSource === 'server'
      ? t('skillsMarketplace.installDialogSubtitle')
      : t('marketplace.installDialogSubtitle');
  const searchPlaceholder =
    mode === 'version'
      ? t('skillsMarketplace.versionSearchPlaceholder')
      : installSource === 'server'
        ? t('skillsMarketplace.searchPlaceholder')
        : t('searchMarketplace');

  const headerExtra = (
    <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
      <div className="relative flex min-w-0 flex-1 items-center rounded-xl border border-black/10 bg-black/5 px-3 py-2 dark:border-white/10 dark:bg-white/5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          data-testid="skills-server-install-search"
          placeholder={searchPlaceholder}
          value={installQuery}
          onChange={(e) => setInstallQuery(e.target.value)}
          className="ml-2 h-auto border-0 bg-transparent p-0 text-[13px] shadow-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {installQuery && (
          <button
            type="button"
            onClick={() => setInstallQuery('')}
            className="ml-1 shrink-0 text-foreground/50 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {mode === 'install' && (
        <div className="flex shrink-0 items-center gap-2 md:self-stretch">
          <label htmlFor="skills-install-source-select" className="whitespace-nowrap text-[12px] text-muted-foreground">
            {t('skillsMarketplace.sourceLabel')}
          </label>
          {(pkg.allowThirdPartyMarketplace ?? true) ? (
            <Select
              id="skills-install-source-select"
              data-testid="skills-install-source-select"
              value={installSource}
              onChange={(e) => handleInstallSourceChange(e.target.value as InstallSkillSource)}
              className="h-10 min-w-[140px] rounded-xl border-black/10 bg-transparent text-[13px] dark:border-white/10 md:min-w-[160px]"
            >
              <option value="server">{t('skillsMarketplace.sourceServer')}</option>
              <option value="clawhub">{t('marketplace.sourceClawHub')}</option>
            </Select>
          ) : (
            <Button
              variant="outline"
              disabled
              className="h-10 rounded-xl border-black/10 bg-transparent text-muted-foreground dark:border-white/10"
            >
              {t('skillsMarketplace.sourceServer')}
            </Button>
          )}
        </div>
      )}
    </div>
  );

  const renderDetailSheet = () => {
    if (!detailSkill) return null;
    const installedSkill = findInstalledServerMarketplaceSkill(safeSkills, detailSkill);
    const action = serverInstallAction(installedSkill, detailSkill);
    const installAction = mode === 'install' && installedSkill ? 'uninstall' : action;
    const installedServerBaseDir =
      installedSkill?.marketplace?.provider === 'server' ? installedSkill.baseDir : undefined;
    const isInstallLoading = !!installing[detailSkill.slug];
    const displayVersion =
      mode === 'install' && installedSkill ? installedVersionText(installedSkill) : detailSkill.version;
    const description = detailSkill.description?.trim();

    return (
      <SkillSideSheetShell
        onClose={() => setDetailSkill(null)}
        title={detailSkill.name}
        subtitle={t('skillsMarketplace.developer', { defaultValue: '开发者' }) + ': ' + (detailSkill.author?.trim() || t('skillsMarketplace.noDeveloper', { defaultValue: '暂无信息' }))}
        testId="skills-server-install-detail-sheet"
        exitTestId="skills-server-install-detail-exit"
        maxWidthClass="sm:max-w-[460px]"
      >
        <div className="flex h-full flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 items-center rounded-full bg-black/[0.04] px-2.5 text-[11px] font-mono font-medium text-foreground/70 dark:bg-white/[0.08]">
                {t('skillsMarketplace.detailVersionLabel')}: v{displayVersion || '—'}
              </span>
              {detailSkill.category ? <SkillCategoryBadge category={detailSkill.category} /> : null}
              <span className="inline-flex h-6 items-center rounded-full bg-black/[0.04] px-2.5 text-[11px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                {installedSkill ? t('skillsMarketplace.localInstalled') : t('skillsMarketplace.detailNotInstalled')}
              </span>
              {typeof detailSkill.downloads === 'number' && (
                <span className="inline-flex h-6 items-center rounded-full bg-black/[0.04] px-2.5 text-[11px] font-medium text-foreground/70 dark:bg-white/[0.08]">
                  {t('skillsMarketplace.detailDownloadsLabel')}: {detailSkill.downloads}
                </span>
              )}
            </div>

            <div className="mt-6">
              <h3 className="text-[13px] font-bold text-foreground/80">{t('skillsMarketplace.detailDescription')}</h3>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-foreground/70">
                {description || t('skillsMarketplace.detailNoDescription')}
              </p>
            </div>
          </div>

          <div className="border-t border-black/10 px-6 py-4 dark:border-white/10">
            {installAction === 'uninstall' ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleUninstall(detailSkill.slug, installedServerBaseDir)}
                disabled={isInstallLoading}
                className="h-9 w-full rounded-full shadow-none font-medium text-xs"
              >
                {isInstallLoading ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" />
                    {t('skillsMarketplace.uninstall')}
                  </span>
                )}
              </Button>
            ) : mode === 'version' && installAction !== 'upgrade' && installAction !== 'rollback' ? null : (
              <Button
                variant="default"
                size="sm"
                onClick={() => void handleInstall(detailSkill.slug)}
                disabled={isInstallLoading}
                className="h-9 w-full rounded-full shadow-none font-medium text-xs"
              >
                {isInstallLoading ? (
                  <LoadingSpinner size="sm" />
                ) : installAction === 'upgrade' ? (
                  t('skillsMarketplace.upgrade')
                ) : installAction === 'rollback' ? (
                  t('skillsMarketplace.rollback')
                ) : (
                  t('skillsMarketplace.install')
                )}
              </Button>
            )}
          </div>
        </div>
      </SkillSideSheetShell>
    );
  };

  return (
    <>
    <SkillSideSheetShell
      onClose={handleClose}
      title={dialogTitle}
      subtitle={dialogSubtitle}
      headerExtra={headerExtra}
      testId="skills-server-install-sheet"
      exitTestId="skills-install-sheet-exit"
    >
      <div className="px-6 py-4">
          {mode === 'install' && effectiveInstallSource === 'server' && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1" data-testid="skills-server-install-categories">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={cn(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedCategory === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-black/5 text-foreground/70 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
                )}
              >
                {t('skillsMarketplace.categoryAll')}
              </button>
              {SKILL_CATEGORY_IDS.map((categoryId) => (
                <button
                  key={categoryId}
                  type="button"
                  onClick={() => setSelectedCategory(categoryId)}
                  className={cn(
                    'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                    selectedCategory === categoryId
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-black/5 text-foreground/70 hover:bg-black/10 dark:bg-white/5 dark:hover:bg-white/10',
                  )}
                >
                  {t(skillCategoryI18nKey(categoryId))}
                </button>
              ))}
            </div>
          )}

          {showServerError && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{resolveServerErrorMessage()}</span>
            </div>
          )}

          {showClawhubError && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{resolveClawhubErrorMessage()}</span>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-sm">
                {effectiveInstallSource === 'server' ? t('skillsMarketplace.loading') : t('marketplace.searching')}
              </p>
            </div>
          )}

          {!loading && effectiveInstallSource === 'server' && visibleServerSkills.length > 0 && (
            <div data-testid="skills-server-install-results" className="flex flex-col gap-1">
              {visibleServerSkills.map((skill) => {
                const installedSkill = findInstalledServerMarketplaceSkill(
                  safeSkills,
                  skill,
                );
                const action = serverInstallAction(installedSkill, skill);
                const installAction = mode === 'install' && installedSkill ? 'uninstall' : action;
                const installedServerBaseDir =
                  installedSkill?.marketplace?.provider === 'server' ? installedSkill.baseDir : undefined;
                const isInstallLoading = !!installing[skill.slug];
                const displayVersion =
                  mode === 'install' && installedSkill ? installedVersionText(installedSkill) : skill.version;

                return (
                  <div
                    key={skill.slug}
                    role="button"
                    tabIndex={0}
                    data-testid="skills-server-install-item"
                    aria-label={t('skillsMarketplace.viewDetail')}
                    onClick={() => setDetailSkill(skill)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailSkill(skill);
                      }
                    }}
                    className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-black/5 dark:border-white/5 last:border-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                      <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                        📦
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <div className="flex min-w-0 items-center gap-2 mb-1">
                          <h3 className="min-w-0 text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                          {skill.category ? <SkillCategoryBadge category={skill.category} /> : null}
                          {skill.localOnly && (
                            <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">• {t('skillsMarketplace.localInstalled')}</span>
                          )}
                          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                            • {t('skillsMarketplace.developer', { defaultValue: '开发者' })}: {skill.author?.trim() || t('skillsMarketplace.noDeveloper', { defaultValue: '暂无信息' })}
                          </span>
                        </div>
                        <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                          {skill.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {displayVersion && (
                        <span className="text-[13px] font-mono text-muted-foreground mr-2">v{displayVersion}</span>
                      )}
                      {installAction === 'uninstall' ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleUninstall(skill.slug, installedServerBaseDir)}
                          disabled={isInstallLoading}
                          className="h-8 px-3 rounded-full shadow-none font-medium text-xs"
                        >
                          {isInstallLoading ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <span className="inline-flex items-center gap-1.5">
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('skillsMarketplace.uninstall')}
                            </span>
                          )}
                        </Button>
                      ) : mode === 'version' && installAction !== 'upgrade' && installAction !== 'rollback' ? null : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void handleInstall(skill.slug)}
                          disabled={isInstallLoading}
                          className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                        >
                          {isInstallLoading ? (
                            <LoadingSpinner size="sm" />
                          ) : installAction === 'upgrade' ? (
                            t('skillsMarketplace.upgrade')
                          ) : installAction === 'rollback' ? (
                            t('skillsMarketplace.rollback')
                          ) : (
                            t('skillsMarketplace.install')
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && effectiveInstallSource === 'clawhub' && searchResults.length > 0 && (
            <div data-testid="skills-clawhub-install-results" className="flex flex-col gap-1">
              {searchResults.map((skill) => {
                const installedSkill = safeSkills.find((s) => isSameSkillIdentity(s, skill.slug));
                const isInstalled = !!installedSkill;
                const isInstallLoading = !!installing[skill.slug];
                const displayVersion = isInstalled ? installedVersionText(installedSkill) : skill.version;

                return (
                  <div
                    key={skill.slug}
                    className="group flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer border-b border-black/5 dark:border-white/5 last:border-0"
                    onClick={() => void hostApi.shell.openExternal(`https://clawhub.ai/s/${skill.slug}`)}
                  >
                    <div className="flex items-start gap-4 flex-1 overflow-hidden pr-4">
                      <div className="h-10 w-10 shrink-0 flex items-center justify-center text-xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden">
                        📦
                      </div>
                      <div className="flex flex-col overflow-hidden">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-[15px] font-semibold text-foreground truncate">{skill.name}</h3>
                          {skill.author && (
                            <span className="text-xs text-muted-foreground">• {skill.author}</span>
                          )}
                        </div>
                        <p className="text-[13.5px] text-muted-foreground line-clamp-1 pr-6 leading-relaxed">
                          {skill.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {displayVersion && (
                        <span className="text-[13px] font-mono text-muted-foreground mr-2">v{displayVersion}</span>
                      )}
                      {isInstalled ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void handleUninstall(skill.slug)}
                          disabled={isInstallLoading}
                          className="h-8 shadow-none"
                        >
                          {isInstallLoading ? <LoadingSpinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      ) : (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void handleInstall(skill.slug)}
                          disabled={isInstallLoading}
                          className="h-8 px-4 rounded-full shadow-none font-medium text-xs"
                        >
                          {isInstallLoading ? <LoadingSpinner size="sm" /> : t('marketplace.install')}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading &&
            ((effectiveInstallSource === 'server' && visibleServerSkills.length === 0 && !marketplaceError) ||
              (effectiveInstallSource === 'clawhub' && searchResults.length === 0 && !searchError)) && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Package className="h-10 w-10 mb-4 opacity-50" />
                <p data-testid="skills-server-install-empty">
                  {effectiveInstallSource === 'server'
                    ? mode === 'version'
                      ? t('skillsMarketplace.noVersionChanges')
                      : installQuery.trim()
                      ? t('skillsMarketplace.noResults')
                      : t('skillsMarketplace.emptyCatalog')
                    : installQuery.trim()
                      ? t('marketplace.noResults')
                      : t('marketplace.emptyPrompt')}
                </p>
              </div>
            )}
      </div>
    </SkillSideSheetShell>
    {renderDetailSheet()}
    <ConfirmDialog
      open={!!confirmDialogState}
      title={confirmDialogState?.title ?? ''}
      message={confirmDialogState?.message ?? ''}
      confirmLabel={confirmDialogState?.confirmLabel}
      cancelLabel={confirmDialogState?.cancelLabel}
      overlayClassName={SKILL_PICKER_MODAL_OVERLAY_CLASS}
      className={SKILL_PICKER_MODAL_CONTENT_CLASS}
      onConfirm={() => resolveConfirm(true)}
      onCancel={() => resolveConfirm(false)}
    />
    </>
  );
}
