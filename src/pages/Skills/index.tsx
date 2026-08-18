/**
 * Skills Page
 * Browse and manage AI skills
 */
import { useEffect, useState, useCallback, useMemo, useRef, startTransition } from 'react';
import {
  Search,
  Puzzle,
  Lock,
  X,
  AlertCircle,
  Plus,
  Key,
  Trash2,
  RefreshCw,
  FolderOpen,
  FileCode,
  Globe,
  Copy,
  Upload,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { SkillSideSheetShell } from '@/components/skills/SkillSideSheetShell';
import { SkillCategoryBadge } from '@/components/skills/SkillCategoryBadge';
import { PublishSkillMetaDialog } from '@/components/skills/PublishSkillMetaDialog';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ServerMarketplaceSheet } from './ServerMarketplaceSheet';
import { GlobalSkillsDialog } from './GlobalSkillsDialog';
import { useSkillsStore } from '@/stores/skills';
import { useGatewayStore } from '@/stores/gateway';
import { isGatewayStopped } from '@/lib/gateway-status';
import type { GatewayStatus } from '@/types/gateway';
import { useAgentsStore } from '@/stores/agents';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { cn } from '@/lib/utils';
import { hostApi, hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  collectMissedReviewNotifications,
  markReviewOutcomeNotified,
  persistMissedReviewNotificationState,
  readNotifiedReviewOutcomes,
  readTrackedPendingReviewRequestIds,
  shouldNotifyReviewOutcome,
  trackPendingReviewRequestId,
} from '@/lib/skill-review-notifications';
import {
  buildPublishPendingFromReviewRequests,
  publishPendingIdentity,
  type PublishPendingReview,
  upsertPublishPendingRecord,
} from '@/lib/skill-publish-pending';
import { toast } from '@/lib/toast';
import type { Skill } from '@/types/skill';
import { rendererExtensionRegistry } from '@/extensions/registry';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { compressPathToTilde } from '@/lib/office-workflow-closure-deliverables';
import {
  addCatalogSkillToSelection,
  countSelectedCatalogSkills,
  canonicalSkillKeyFromSkill,
  normalizeSkillKey,
  normalizeSkillsSelectionForPersist,
  removeCatalogSkillFromSelection,
} from '@/lib/skill-lookup-aliases';
import { DEFAULT_SKILL_CATEGORY } from '@/lib/skill-categories';
import { AgentSelectorDialog } from '@/components/skills/AgentSelectorDialog';
import { planAgentSelectorPersistActions, planSkillDisableActions, resolveAgentSelectorSaveToastKey } from '@/lib/agent-selector-draft';
import { resolveAgentIdSelection } from '@/lib/agent-lookup';
import {
  SKILL_FETCH_ERROR_KEYS,
  SKILL_PICKER_MODAL_CONTENT_CLASS,
  SKILL_PICKER_MODAL_OVERLAY_CLASS,
} from '@/components/skills/skill-picker-styles';
import pkg from '../../../package.json';

const PENDING_REVIEW_BUTTON_CLASS =
  'h-8 shrink-0 shadow-none border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 disabled:opacity-100';

function formatSkillIdList(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return '—';
  return ids.join(', ');
}

type SkillsGatewayBannerState = 'none' | 'stopped';

function getSkillsGatewayBannerState(status: GatewayStatus): SkillsGatewayBannerState {
  if (isGatewayStopped(status)) {
    return 'stopped';
  }
  return 'none';
}

// Skill detail dialog component
interface SkillDetailDialogProps {
  skill: Skill | null;
  isOpen: boolean;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
  onUninstall?: (slug: string) => void;
  onOpenFolder?: (skill: Skill) => Promise<void> | void;
}

import { DynamicRenderer, DynamicUISchema } from '@/components/skills/DynamicRenderer';

function isServerMarketplaceSkill(skill: Skill): boolean {
  return skill.marketplace?.provider === 'server' && !skill.isBundled;
}

function resolveSkillSourceLabel(skill: Skill, t: TFunction<'skills'>): string {
  const source = (skill.source || '').trim().toLowerCase();
  if (!source) {
    if (skill.isBundled) return t('source.badge.bundled', { defaultValue: 'Bundled' });
    return t('source.badge.unknown', { defaultValue: 'Unknown source' });
  }
  if (source === 'openclaw-bundled') return t('source.badge.bundled', { defaultValue: 'Bundled' });
  if (source === 'openclaw-managed') return t('source.badge.managed', { defaultValue: 'Managed' });
  if (source === 'openclaw-workspace') return t('source.badge.workspace', { defaultValue: 'Workspace' });
  if (source === 'openclaw-extra') return t('source.badge.extra', { defaultValue: 'Plugin dir' });
  if (source === 'openclaw-plugin') return t('source.badge.plugin', { defaultValue: 'Plugin dir' });
  if (source === 'agents-skills-personal') return t('source.badge.agentsPersonal', { defaultValue: 'Personal dir' });
  if (source === 'agents-skills-project') return t('source.badge.agentsProject', { defaultValue: 'Project .agents' });
  if (source === 'agent-assignment') return t('source.badge.agentAssignment', { defaultValue: 'Agent assignment' });
  return source;
}

function resolveSkillDirectoryPath(skill: Skill): string {
  // Prefer the full SKILL.md path so nested/deeply-extracted skills show exactly
  // where their manifest was found; fall back to the install directory.
  const filePath = skill.filePath?.trim();
  if (filePath) return compressPathToTilde(filePath);
  const base = skill.baseDir?.trim();
  if (base) return compressPathToTilde(base);
  return '';
}

function SkillDirectoryLine({ skill, t }: { skill: Skill; t: TFunction<'skills'> }) {
  const label = resolveSkillSourceLabel(skill, t);
  const path = resolveSkillDirectoryPath(skill);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 inline-flex items-center h-5 px-1.5 rounded-md text-[10px] font-medium bg-black/5 dark:bg-white/8 text-foreground/55 border border-black/5 dark:border-white/8">
        {label}
      </span>
      {path ? (
        <span className="text-[11px] text-foreground/45 font-mono truncate" title={path}>
          {path}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/70">
          {t('detail.pathUnavailable', { defaultValue: 'Path not available' })}
        </span>
      )}
    </div>
  );
}

function getSkillListDescription(skill: Skill, t: TFunction<['skills', 'agents']>): string {
  const i18nKey = `agents:skills.descriptions.${skill.id}`;
  const translated = t(i18nKey, { defaultValue: '' });
  if (translated && translated !== i18nKey) {
    return translated;
  }
  const desc = skill.description?.trim();
  if (desc) return desc;
  return t('list.noDescription', { defaultValue: '—' });
}

function formatSkillVersionLabel(version: string | undefined): string | null {
  const v = version?.trim();
  if (!v) return null;
  return v.startsWith('v') ? v : `v${v}`;
}

function SkillDetailDialog({ skill, isOpen, onClose, onToggle, onUninstall, onOpenFolder }: SkillDetailDialogProps) {
  const { t } = useTranslation('skills');
  const { fetchSkills } = useSkillsStore();
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [apiKey, setApiKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [uiSchema, setUiSchema] = useState<DynamicUISchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const detailMetaComponents = rendererExtensionRegistry.getSkillDetailMetaComponents();

  // Initialize config and schema from skill
  useEffect(() => {
    if (!skill) return;

    // Load custom UI schema
    const loadSchema = async () => {
      setSchemaLoading(true);
      try {
        const schema = await hostApi.skills.getUiSchema({
          skillKey: skill.id,
          baseDir: skill.baseDir
        }) as DynamicUISchema | null;
        setUiSchema(schema);
      } catch (err) {
        console.error('Failed to load schema:', err);
        setUiSchema(null);
      } finally {
        setSchemaLoading(false);
      }
    };
    loadSchema();

    const nextApiKey = skill.config?.apiKey ? String(skill.config.apiKey) : '';
    const nextEnvVars = skill.config?.env
      ? Object.entries(skill.config.env).map(([key, value]) => ({
        key,
        value: String(value),
      }))
      : [];
    queueMicrotask(() => {
      setApiKey(nextApiKey);
      setEnvVars(nextEnvVars);
    });
  }, [skill]);

  const handleOpenClawhub = async () => {
    if (!skill?.slug) return;
    await hostApi.shell.openExternal(`https://clawhub.ai/s/${skill.slug}`);
  };

  const handleOpenEditor = async () => {
    if (!skill?.id) return;
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/open-readme', {
        method: 'POST',
        body: JSON.stringify({ skillKey: skill.id, slug: skill.slug, baseDir: skill.baseDir }),
      });
      if (result.success) {
        toast.success(t('toast.openedEditor'));
      } else {
        toast.error(result.error || t('toast.failedEditor'));
      }
    } catch (err) {
      toast.error(t('toast.failedEditor') + ': ' + String(err));
    }
  };

  const handleCopyPath = async () => {
    if (!skill?.baseDir) return;
    try {
      await navigator.clipboard.writeText(skill.baseDir);
      toast.success(t('toast.copiedPath'));
    } catch (err) {
      toast.error(t('toast.failedCopyPath') + ': ' + String(err));
    }
  };

  const handleAddEnv = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const handleUpdateEnv = (index: number, field: 'key' | 'value', value: string) => {
    const newVars = [...envVars];
    newVars[index] = { ...newVars[index], [field]: value };
    setEnvVars(newVars);
  };

  const handleRemoveEnv = (index: number) => {
    const newVars = [...envVars];
    newVars.splice(index, 1);
    setEnvVars(newVars);
  };

  const handleSaveConfig = async () => {
    if (isSaving || !skill) return;
    setIsSaving(true);
    try {
      // Build env object, filtering out empty keys
      const envObj = envVars.reduce((acc, curr) => {
        const key = curr.key.trim();
        const value = curr.value.trim();
        if (key) {
          acc[key] = value;
        }
        return acc;
      }, {} as Record<string, string>);

      // Use direct file access instead of Gateway RPC for reliability
      const result = await hostApi.skills.updateConfig(
        {
          skillKey: skill.id,
          apiKey: apiKey || '', // Empty string will delete the key
          env: envObj // Empty object will clear all env vars
        }
      ) as { success: boolean; error?: string };

      if (!result.success) {
        throw new Error(result.error || 'Unknown error');
      }

      // Refresh skills from gateway to get updated config
      await fetchSkills();

      toast.success(t('detail.configSaved'));
    } catch (err) {
      toast.error(t('toast.failedSave') + ': ' + String(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        data-testid="skill-detail-sheet"
        className="w-full sm:max-w-[450px] p-0 flex flex-col border-l border-black/10 dark:border-white/10 bg-background shadow-[0_0_40px_rgba(0,0,0,0.2)]"
        side="right"
      >
        <button
          type="button"
          onClick={onClose}
          data-testid="skill-detail-close"
          className="no-drag absolute right-4 top-4 z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
          aria-label={t('common:close', { defaultValue: 'Close' })}
        >
          <X className="h-4 w-4" />
        </button>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-8 py-10">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 flex items-center justify-center rounded-full bg-white dark:bg-accent border border-black/5 dark:border-white/5 shrink-0 mb-4 relative shadow-sm">
              <span className="text-3xl">{skill.icon || '🔧'}</span>
              {skill.isCore && (
                <div className="absolute -bottom-1 -right-1 bg-surface-modal rounded-full p-1 shadow-sm border border-black/5 dark:border-white/5">
                  <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
              )}
            </div>
            <h2 className="text-[28px] font-serif text-foreground font-normal mb-3 text-center tracking-tight">
              {skill.name}
            </h2>
            <div
              data-skill-detail-meta-row="1"
              className="flex items-center justify-center flex-wrap gap-2.5 mb-6 opacity-80"
            >
              {skill.version && (
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors"
                >
                  v{skill.version}
                </Badge>
              )}
              <Badge
                variant="secondary"
                className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] border-0 shadow-none text-foreground/70 transition-colors"
              >
                {skill.isCore
                  ? t('detail.coreSystem')
                  : skill.isBundled
                    ? t('detail.bundled')
                    : t('detail.userInstalled')}
              </Badge>
              {detailMetaComponents.map((DetailMetaComponent, index) => (
                <DetailMetaComponent key={`skill-detail-meta-${index}`} skill={skill} />
              ))}
            </div>

            {skill.description && (
              <p className="text-[14px] text-foreground/70 font-medium leading-[1.6] text-center px-4">
                {skill.description}
              </p>
            )}
          </div>

          <div className="space-y-7 px-1">
            <div className="space-y-2">
              <h3 className="text-[13px] font-bold text-foreground/80">{t('detail.source')}</h3>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap font-mono text-tiny font-medium px-3 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                >
                  {resolveSkillSourceLabel(skill, t)}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={skill.baseDir || t('detail.pathUnavailable')}
                  readOnly
                  className="h-[38px] font-mono text-[12px] bg-transparent border-black/10 dark:border-white/10 rounded-xl text-foreground/70"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={handleCopyPath}
                  title={t('detail.copyPath')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-[38px] w-[38px] border-black/10 dark:border-white/10"
                  disabled={!skill.baseDir}
                  onClick={() => onOpenFolder?.(skill)}
                  title={t('detail.openActualFolder')}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Skill Configuration Section */}
            {schemaLoading ? (
              <div className="py-8 flex justify-center">
                <LoadingSpinner />
              </div>
            ) : uiSchema ? (
              <div className="py-4 border-t border-black/5 dark:border-white/5">
                <DynamicRenderer schema={uiSchema} skillKey={skill.id} onReloadRequested={fetchSkills} skillConfig={skill.config} />
              </div>
            ) : (
              <>
                {/* API Key Section */}
                {!skill.isCore && (
                  <div className="space-y-2">
                    <h3 className="text-[13px] font-bold flex items-center gap-2 text-foreground/80">
                      <Key className="h-3.5 w-3.5 text-blue-500" />
                      {t('detail.apiKey')}
                    </h3>
                    <Input
                      placeholder={t('detail.apiKeyPlaceholder', 'Enter API Key (optional)')}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      type="password"
                      className="h-[44px] font-mono text-[13px] bg-transparent border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary shadow-sm transition-all text-foreground placeholder:text-foreground/40"
                    />
                    <p className="text-[12px] text-foreground/50 mt-2 font-medium">
                      {t('detail.apiKeyDesc', 'The primary API key for this skill. Leave blank if not required or configured elsewhere.')}
                    </p>
                  </div>
                )}

                {/* Environment Variables Section */}
                {!skill.isCore && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <h3 className="text-[13px] font-bold text-foreground/80">
                          {t('detail.envVars')}
                          {envVars.length > 0 && (
                            <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-[10px] h-5 bg-black/10 dark:bg-white/10 text-foreground">
                              {envVars.length}
                            </Badge>
                          )}
                        </h3>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[12px] font-semibold text-foreground/80 gap-1.5 px-2.5 hover:bg-black/5 dark:hover:bg-white/5"
                        onClick={handleAddEnv}
                      >
                        <Plus className="h-3 w-3" strokeWidth={3} />
                        {t('detail.addVariable', 'Add Variable')}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {envVars.length === 0 && (
                        <div className="text-[13px] text-foreground/50 font-medium italic flex items-center bg-surface-input border border-black/5 dark:border-white/5 rounded-xl px-4 py-3 shadow-sm">
                          {t('detail.noEnvVars', 'No environment variables configured.')}
                        </div>
                      )}

                      {envVars.map((env, index) => (
                        <div className="flex items-center gap-3" key={index}>
                          <Input
                            value={env.key}
                            onChange={(e) => handleUpdateEnv(index, 'key', e.target.value)}
                            className="flex-1 h-[40px] font-mono text-[13px] bg-transparent border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/50 shadow-sm text-foreground"
                            placeholder={t('detail.keyPlaceholder', 'Key')}
                          />
                          <Input
                            value={env.value}
                            onChange={(e) => handleUpdateEnv(index, 'value', e.target.value)}
                            className="flex-1 h-[40px] font-mono text-[13px] bg-transparent border-black/10 dark:border-white/10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary/50 shadow-sm text-foreground"
                            placeholder={t('detail.valuePlaceholder', 'Value')}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-10 w-10 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0 rounded-xl transition-colors"
                            onClick={() => handleRemoveEnv(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* External Links */}
            {skill.slug && !skill.isBundled && !skill.isCore && (
              <div className="flex gap-2 justify-center pt-8">
                {(pkg.allowThirdPartyMarketplace ?? true) && (
                  <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/70" onClick={handleOpenClawhub}>
                    <Globe className="h-[12px] w-[12px]" />
                    ClawHub
                  </Button>
                )}
                <Button variant="outline" size="sm" className="h-[28px] text-[11px] font-medium px-3 gap-1.5 rounded-full border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/70" onClick={handleOpenEditor}>
                  <FileCode className="h-[12px] w-[12px]" />
                  {t('detail.openManual')}
                </Button>
              </div>
            )}
          </div>

          {/* Centered Footer Buttons */}
          <div className="pt-8 pb-4 flex items-center justify-center gap-4 w-full px-2 max-w-[340px] mx-auto">
            {!skill.isCore && !uiSchema && (
              <Button
                onClick={handleSaveConfig}
                className={cn(
                  "flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm border border-transparent transition-all",
                  "bg-primary hover:bg-primary/90 text-primary-foreground"
                )}
                disabled={isSaving}
              >
                {isSaving ? t('detail.saving') : t('detail.saveConfig')}
              </Button>
            )}

            {!skill.isCore && (
              <Button
                variant="outline"
                className="flex-1 h-[42px] text-[13px] rounded-full font-semibold shadow-sm bg-transparent border-black/20 dark:border-white/20 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-foreground/80 hover:text-foreground"
                onClick={() => {
                  if (!skill.isBundled && onUninstall && skill.slug) {
                    onUninstall(skill.slug);
                    onClose();
                  } else {
                    onToggle(!skill.enabled);
                  }
                }}
              >
                {!skill.isBundled && onUninstall
                  ? t('detail.uninstall')
                  : skill.enabled
                    ? t('detail.disable')
                    : t('detail.enable')}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

type SkillPublishReviewStatusEvent = {
  type?: string;
  action?: string;
  request_type?: 'publish' | 'unlist' | string;
  request_id?: number;
  status?: 'approved' | 'rejected' | string;
  comments?: string;
  skill_id?: string;
  display_name?: string;
  reason?: string;
  removed?: string[];
  failed?: string[];
  version?: string;
  version_base?: string;
  archive_hash?: string;
  listing_revision?: string;
};

function normalizeSkillIdentity(value?: string): string {
  return String(value || '').trim().toLowerCase();
}

function inferSkillVersionBase(value?: string): string {
  const normalized = normalizeSkillIdentity(value);
  const match = normalized.match(/^(.+)-\d+_\d+_\d+$/);
  return match?.[1] || normalized;
}

function basenameFromPath(value?: string): string {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function skillIdentityAliases(values: Array<string | undefined>): Set<string> {
  const aliases = new Set<string>();
  for (const value of values) {
    const normalized = normalizeSkillIdentity(value);
    if (!normalized) continue;
    aliases.add(normalized);
    aliases.add(inferSkillVersionBase(normalized));
  }
  return aliases;
}

function localServerSkillMatchesEvent(skill: Skill, event: SkillPublishReviewStatusEvent): boolean {
  if (skill.marketplace?.provider !== 'server') return false;
  const localAliases = skillIdentityAliases([
    skill.marketplace.versionBase,
    skill.marketplace.slug,
    skill.slug,
    skill.id,
    skill.name,
    basenameFromPath(skill.baseDir),
  ]);
  const eventAliases = skillIdentityAliases([
    event.version_base,
    event.skill_id,
    event.display_name,
  ]);
  return [...eventAliases].some((alias) => localAliases.has(alias));
}

function compareSkillVersionText(a?: string, b?: string): number | null {
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

function formatSkillNameWithVersion(name: string, version?: string): string {
  const trimmedName = String(name || '').trim();
  const trimmedVersion = String(version || '').trim();
  if (!trimmedVersion || trimmedName.endsWith(`-v-${trimmedVersion}`)) {
    return trimmedName || '—';
  }
  return `${trimmedName || '—'}-v-${trimmedVersion}`;
}

function publishedSkillVersionBase(skill: PublishedMarketplaceSkill): string {
  return skill.version_base?.trim().toLowerCase()
    || inferSkillVersionBase(skill.skill_id)
    || skill.display_name?.trim().toLowerCase()
    || skill.skill_id.trim().toLowerCase();
}

function dedupePublishedSkillsByVersionBase(skills: PublishedMarketplaceSkill[]): PublishedMarketplaceSkill[] {
  const byBase = new Map<string, PublishedMarketplaceSkill>();
  for (const skill of skills) {
    const base = publishedSkillVersionBase(skill);
    const existing = byBase.get(base);
    if (!existing) {
      byBase.set(base, skill);
      continue;
    }
    if (compareSkillVersionText(skill.version, existing.version) === 1) {
      byBase.set(base, skill);
    }
  }
  return [...byBase.values()];
}

function ownPublishListingKey(event: SkillPublishReviewStatusEvent): string {
  const versionBase = normalizeSkillIdentity(event.version_base) || inferSkillVersionBase(event.skill_id);
  const skillId = normalizeSkillIdentity(event.skill_id);
  const version = String(event.version || '').trim();
  return [versionBase, skillId, version].filter(Boolean).join('|');
}

function isOwnClientPublishListing(
  event: SkillPublishReviewStatusEvent,
  publishPending: Record<string, PublishPendingReview>,
  publishedSkills: PublishedMarketplaceSkill[],
): boolean {
  if (event.action === 'rollback') return false;

  const eventVersionBase = normalizeSkillIdentity(event.version_base) || inferSkillVersionBase(event.skill_id);
  const eventSkillId = normalizeSkillIdentity(event.skill_id);
  const eventDisplayName = normalizeSkillIdentity(event.display_name);
  const eventVersion = String(event.version || '').trim();
  const eventArchiveHash = normalizeSkillIdentity(event.archive_hash);

  for (const pending of Object.values(publishPending)) {
    const pendingBase = normalizeSkillIdentity(pending.versionBase) || inferSkillVersionBase(pending.skillId);
    if (eventVersionBase && pendingBase && eventVersionBase === pendingBase) return true;
    if (eventSkillId && normalizeSkillIdentity(pending.skillId) === eventSkillId) return true;
    if (eventDisplayName && normalizeSkillIdentity(pending.displayName) === eventDisplayName) return true;
    if (eventVersion && pending.version?.trim() === eventVersion && eventVersionBase && pendingBase === eventVersionBase) {
      return true;
    }
  }

  for (const published of publishedSkills) {
    const base = publishedSkillVersionBase(published);
    if (eventVersionBase && base === eventVersionBase) {
      if (!eventVersion || !published.version || eventVersion === published.version.trim()) return true;
    }
    if (eventSkillId && normalizeSkillIdentity(published.skill_id) === eventSkillId) return true;
    if (eventArchiveHash && normalizeSkillIdentity(published.archive_hash) === eventArchiveHash) return true;
  }

  return false;
}

function clearPublishPendingForReviewResult(
  prev: Record<string, PublishPendingReview>,
  event: {
    request_id?: number;
    skill_id?: string;
    display_name?: string;
    version_base?: string;
  },
): Record<string, PublishPendingReview> {
  const next = { ...prev };
  const versionBase = event.version_base?.trim().toLowerCase();
  const displayName = event.display_name?.trim().toLowerCase();
  for (const [key, pending] of Object.entries(prev)) {
    if (typeof event.request_id === 'number' && pending.requestId === event.request_id) {
      delete next[key];
      continue;
    }
    if (versionBase && pending.versionBase?.trim().toLowerCase() === versionBase) {
      delete next[key];
      continue;
    }
    if (displayName && pending.displayName?.trim().toLowerCase() === displayName) {
      delete next[key];
      continue;
    }
    const identityKey = publishPendingIdentity({
      skillId: event.skill_id,
      displayName: event.display_name,
      versionBase: event.version_base,
      requestId: event.request_id,
    });
    if (key === identityKey) {
      delete next[key];
    }
  }
  return next;
}

type PublishedMarketplaceSkill = {
  skill_id: string;
  display_name?: string;
  description?: string;
  version?: string;
  version_base?: string;
  archive_hash?: string;
  size_bytes?: number;
  published_at?: string;
};

type PublishRejectedReview = {
  requestId?: number;
  skillId?: string;
  displayName?: string;
  comments?: string;
};

type MarketplaceReviewRequest = {
  id: number;
  review_no?: string;
  request_type?: 'publish' | 'unlist' | string;
  status?: 'pending' | 'approved' | 'rejected' | string;
  target_skill_id?: string;
  display_name?: string;
  description?: string;
  archive_hash?: string;
  version?: string;
  version_base?: string;
  review_comments?: string;
  published_skill_id?: string;
};

const DISMISSED_REVIEW_REQUEST_IDS_KEY = 'skills.marketplace.dismissedReviewRequestIds.v1';

function readDismissedReviewRequestIds(): Set<number> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_REVIEW_REQUEST_IDS_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  } catch {
    return new Set();
  }
}

function writeDismissedReviewRequestIds(ids: Set<number>): void {
  try {
    window.localStorage.setItem(DISMISSED_REVIEW_REQUEST_IDS_KEY, JSON.stringify([...ids]));
  } catch {
    // Ignore localStorage failures; the row can still be hidden for this session.
  }
}

function publishReviewKey(skillId?: string, requestId?: number): string {
  const normalizedSkillId = skillId?.trim();
  if (normalizedSkillId) return `skill:${normalizedSkillId}`;
  if (typeof requestId === 'number') return `request:${requestId}`;
  return 'local:unknown';
}

function findPublishReviewKey<T extends { skillId?: string; requestId?: number }>(
  records: Record<string, T>,
  skillId?: string,
  requestId?: number,
): string | undefined {
  const normalizedSkillId = skillId?.trim();
  return Object.entries(records).find(([key, record]) => (
    (normalizedSkillId && (record.skillId === normalizedSkillId || key === `skill:${normalizedSkillId}`)) ||
    (typeof requestId === 'number' && (record.requestId === requestId || key === `request:${requestId}`))
  ))?.[0];
}

function resolveUnlistSkillId(
  pendingMap: Record<string, { reviewNo: string; requestId?: number }>,
  params: { skillId?: string; requestId?: number },
): string | undefined {
  const direct = params.skillId?.trim();
  if (direct) return direct;
  if (typeof params.requestId !== 'number') return undefined;
  return Object.entries(pendingMap).find(([, pending]) => pending.requestId === params.requestId)?.[0];
}

export function SkillsSettings() {
  const {
    skills,
    loading,
    error,
    fetchSkills,
    uninstallSkill,
    updateSkillAgents,
  } = useSkillsStore();
  const { t } = useTranslation(['skills', 'agents']);
  const gatewayStatus = useGatewayStore((state) => state.status);
  const {
    agents: allAgents,
    fetchAgents,
    defaultAgentSkills,
    updateGlobalAgentSkills,
  } = useAgentsStore();
  const [globalSkillsOpen, setGlobalSkillsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [installSheetOpen, setInstallSheetOpen] = useState(false);
  const [versionSheetOpen, setVersionSheetOpen] = useState(false);
  const [catalogRefreshTrigger, setCatalogRefreshTrigger] = useState(0);
  const [managePublishSheetOpen, setManagePublishSheetOpen] = useState(false);
  const [publishedSkills, setPublishedSkills] = useState<PublishedMarketplaceSkill[]>([]);
  const [publishedSkillsLoading, setPublishedSkillsLoading] = useState(false);
  const [publishPending, setPublishPending] = useState<Record<string, PublishPendingReview>>({});
  const [publishRejected, setPublishRejected] = useState<Record<string, PublishRejectedReview>>({});
  const publishPendingRef = useRef(publishPending);
  const publishedSkillsRef = useRef(publishedSkills);
  const suppressOwnListedToastRef = useRef(new Set<string>());
  const [dismissedReviewRequestIds, setDismissedReviewRequestIds] = useState<Set<number>>(() => readDismissedReviewRequestIds());
  const [unlistRequesting, setUnlistRequesting] = useState<Record<string, boolean>>({});
  const [unlistPending, setUnlistPending] = useState<Record<string, { reviewNo: string; requestId?: number }>>({});
  const [unlistRejected, setUnlistRejected] = useState<Record<string, string>>({});
  const [cancelingReviewIds, setCancelingReviewIds] = useState<Record<number, boolean>>({});
  const [publishSkillBusy, setPublishSkillBusy] = useState(false);
  const [publishMetaOpen, setPublishMetaOpen] = useState(false);
  const [publishMetaFilePath, setPublishMetaFilePath] = useState('');
  const [publishAuthor, setPublishAuthor] = useState('');
  const [publishVersion, setPublishVersion] = useState('');
  const [publishCategory, setPublishCategory] = useState<string>(DEFAULT_SKILL_CATEGORY);
  const [publishMetaError, setPublishMetaError] = useState('');
  // Default author (client username) + remote published version, resolved from the picked zip.
  const [publishUsername, setPublishUsername] = useState('');
  const [publishRemoteVersion, setPublishRemoteVersion] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedSource, setSelectedSource] = useState<'all' | 'built-in' | 'marketplace'>('all');

  // Agent selector dialog state
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [skillForAgentSelector, setSkillForAgentSelector] = useState<Skill | null>(null);
  const [agentSelectorLoading, setAgentSelectorLoading] = useState(false);

  const gatewayRunning = gatewayStatus.state === 'running';
  const gatewayReportedReady = gatewayStatus.gatewayReady !== false;
  const gatewayRuntimeKey = `${gatewayStatus.pid ?? 'none'}:${gatewayStatus.connectedAt ?? 'none'}:${gatewayStatus.port}`;
  const gatewayBannerState = getSkillsGatewayBannerState(gatewayStatus);
  const [showGatewayBanner, setShowGatewayBanner] = useState(false);
  const [marketplaceAvailable, setMarketplaceAvailable] = useState(false);

  useEffect(() => {
    publishPendingRef.current = publishPending;
  }, [publishPending]);

  useEffect(() => {
    publishedSkillsRef.current = publishedSkills;
  }, [publishedSkills]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gatewayBannerState === 'none') {
      timer = setTimeout(() => {
        setShowGatewayBanner(false);
      }, 0);
    } else {
      timer = setTimeout(() => {
        setShowGatewayBanner(true);
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [gatewayBannerState]);

  useEffect(() => {
    // Skills load from local disk and no longer require the gateway. When the gateway is
    // running but not yet ready, keep retrying so we merge runtime status once it comes up.
    let cancelled = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const attemptFetch = async () => {
      const ok = await fetchSkills();
      if (cancelled || !ok) return;
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    };

    void attemptFetch();

    if (gatewayRunning && !gatewayReportedReady) {
      retryTimer = setInterval(() => {
        void attemptFetch();
      }, 5_000);
    }

    return () => {
      cancelled = true;
      if (retryTimer) {
        clearInterval(retryTimer);
      }
    };
  }, [fetchSkills, gatewayReportedReady, gatewayRunning, gatewayRuntimeKey]);

  useEffect(() => {
    // Load agents list for the agent selector (fork feature).
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    let cancelled = false;
    void hostApi.skills
      .clawhubCapability()
      .then((result) => {
        if (cancelled) return;
        setMarketplaceAvailable(
          Boolean(result.success && (result.capability?.canInstall || result.capability?.canSearch)),
        );
      })
      .catch(() => {
        if (!cancelled) setMarketplaceAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const removePublishedSkillFromUnlistPage = useCallback((skillId: string) => {
    setPublishedSkills((prev) => prev.filter((skill) => skill.skill_id !== skillId));
    setPublishPending((prev) => {
      const key = findPublishReviewKey(prev, skillId);
      if (!key) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPublishRejected((prev) => {
      const key = findPublishReviewKey(prev, skillId);
      if (!key) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setUnlistPending((prev) => {
      const next = { ...prev };
      delete next[skillId];
      return next;
    });
    setUnlistRejected((prev) => {
      const next = { ...prev };
      delete next[skillId];
      return next;
    });
  }, []);

  const clearUnlistPendingReview = useCallback((params: {
    skillId?: string;
    requestId?: number;
    rejectedComment?: string;
  }) => {
    let resolvedSkillId: string | undefined;
    setUnlistPending((prev) => {
      resolvedSkillId = resolveUnlistSkillId(prev, params);
      if (!resolvedSkillId) return prev;
      const next = { ...prev };
      delete next[resolvedSkillId];
      return next;
    });
    if (resolvedSkillId && params.rejectedComment) {
      setUnlistRejected((prev) => ({ ...prev, [resolvedSkillId!]: params.rejectedComment! }));
    }
  }, []);

  const showReviewOutcomeToast = useCallback((params: {
    requestType: 'publish' | 'unlist';
    status: 'approved' | 'rejected';
    name: string;
    version?: string;
    comments?: string;
  }) => {
    const displayName = params.requestType === 'publish' && params.status === 'approved'
      ? formatSkillNameWithVersion(params.name, params.version)
      : params.name;
    if (params.requestType === 'unlist') {
      if (params.status === 'approved') {
        toast.success(t('toast.unlistApproved', { name: displayName }));
        return;
      }
      toast.error(params.comments
        ? t('toast.unlistRejectedWithComments', { name: displayName, comments: params.comments })
        : t('toast.unlistRejected', { name: displayName }));
      return;
    }
    if (params.status === 'approved') {
      toast.success(t('toast.publishApproved', { name: displayName }));
      return;
    }
    toast.error(params.comments
      ? t('toast.publishRejectedWithComments', { name: displayName, comments: params.comments })
      : t('toast.publishRejected', { name: displayName }));
  }, [t]);

  const notifyReviewOutcomeIfNeeded = useCallback((params: {
    requestId?: number;
    status?: string;
    requestType: 'publish' | 'unlist';
    name: string;
    version?: string;
    comments?: string;
  }) => {
    if (!shouldNotifyReviewOutcome(params.requestId, params.status)) {
      return false;
    }
    markReviewOutcomeNotified(params.requestId, params.status!);
    showReviewOutcomeToast({
      requestType: params.requestType,
      status: params.status as 'approved' | 'rejected',
      name: params.name,
      version: params.version,
      comments: params.comments,
    });
    return true;
  }, [showReviewOutcomeToast]);

  const rememberOwnPublishListedEvent = useCallback((event: SkillPublishReviewStatusEvent) => {
    const key = ownPublishListingKey(event);
    if (!key) return;
    suppressOwnListedToastRef.current.add(key);
    window.setTimeout(() => {
      suppressOwnListedToastRef.current.delete(key);
    }, 60_000);
  }, []);

  const shouldSkipOwnPublishListedToast = useCallback((event: SkillPublishReviewStatusEvent) => {
    const key = ownPublishListingKey(event);
    if (key && suppressOwnListedToastRef.current.has(key)) {
      return true;
    }
    return isOwnClientPublishListing(event, publishPendingRef.current, publishedSkillsRef.current);
  }, []);

  useEffect(() => {
    return subscribeHostEvent<SkillPublishReviewStatusEvent>('skill:review-status', (event) => {
      const name = event.display_name || event.skill_id || '—';
      if (event.type === 'workspace_skill_listed') {
        const serverVersion = event.version || '—';
        if (event.action === 'rollback') {
          const localHigherSkill = skills.find((skill) => {
            if (!localServerSkillMatchesEvent(skill, event)) return false;
            return compareSkillVersionText(skill.marketplace?.installedVersion || skill.version, event.version) === 1;
          });
          const localHigherVersion = localHigherSkill?.marketplace?.installedVersion || localHigherSkill?.version;
          if (localHigherVersion) {
            toast.info(t('toast.serverSkillRolledBackWithLocalHigher', {
              name,
              version: serverVersion,
              localVersion: localHigherVersion,
            }));
          } else {
            toast.info(t('toast.serverSkillRolledBack', { name, version: serverVersion }));
          }
        } else if (!shouldSkipOwnPublishListedToast(event)) {
          toast.info(t('toast.serverSkillListed', {
            name,
            version: serverVersion,
          }));
        }
        setCatalogRefreshTrigger((value) => value + 1);
        void fetchSkills();
        return;
      }
      if (event.type === 'workspace_skill_unlisted') {
        if (event.skill_id) {
          removePublishedSkillFromUnlistPage(event.skill_id);
        }
        if (event.reason === 'overwrite same-name skill') {
          toast.info(t('toast.serverSkillUnlistedReinstallRequired'));
        } else if (event.failed && event.failed.length > 0) {
          toast.error(t('toast.serverSkillUnlistedDeleteFailed', { name }));
        } else if (event.removed && event.removed.length > 0) {
          toast.info(t('toast.serverSkillUnlistedRemoved', { name }));
        } else {
          toast.info(t('toast.serverSkillUnlistedKeptLocal', { name }));
        }
        void fetchSkills();
        return;
      }
      if (event.type !== 'workspace_skill_publish_review_result') return;
      const comments = event.comments?.trim();
      if (event.request_type === 'unlist') {
        if (event.status === 'approved') {
          if (event.skill_id) {
            removePublishedSkillFromUnlistPage(event.skill_id);
          }
          notifyReviewOutcomeIfNeeded({
            requestId: event.request_id,
            status: event.status,
            requestType: 'unlist',
            name,
          });
          void fetchSkills();
          return;
        }
        if (event.status === 'rejected') {
          clearUnlistPendingReview({
            skillId: event.skill_id,
            requestId: event.request_id,
            rejectedComment: comments,
          });
          notifyReviewOutcomeIfNeeded({
            requestId: event.request_id,
            status: event.status,
            requestType: 'unlist',
            name,
            comments,
          });
          return;
        }
      }
      if (event.status === 'approved') {
        rememberOwnPublishListedEvent(event);
        setPublishPending((prev) => clearPublishPendingForReviewResult(prev, event));
        setPublishRejected((prev) => {
          const key = findPublishReviewKey(prev, event.skill_id, event.request_id);
          if (!key) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        if (event.skill_id) {
          const approvedSkillId = event.skill_id;
          setPublishedSkills((prev) => dedupePublishedSkillsByVersionBase([
            {
              skill_id: approvedSkillId,
              display_name: event.display_name,
              description: event.skill_id,
              version: event.version,
              version_base: event.version_base,
              archive_hash: event.archive_hash,
            },
            ...prev,
          ]));
        }
        notifyReviewOutcomeIfNeeded({
          requestId: event.request_id,
          status: event.status,
          requestType: 'publish',
          name,
          version: event.version,
        });
        void fetchSkills();
        void hostApi.skills.listPublishedMarketplace()
          .then((res) => {
            if (!res.success) return;
            setPublishedSkills(dedupePublishedSkillsByVersionBase((res.skills ?? []) as PublishedMarketplaceSkill[]));
          })
          .catch(() => {
            // Best-effort background refresh after approval.
          });
        return;
      }
      if (event.status === 'rejected') {
        setPublishPending((prev) => {
          const key = findPublishReviewKey(prev, event.skill_id, event.request_id);
          if (!key) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setPublishRejected((prev) => ({
          ...prev,
          [publishReviewKey(event.skill_id, event.request_id)]: {
            skillId: event.skill_id,
            requestId: event.request_id,
            displayName: event.display_name,
            comments,
          },
        }));
        notifyReviewOutcomeIfNeeded({
          requestId: event.request_id,
          status: event.status,
          requestType: 'publish',
          name,
          comments,
        });
      }
    });
  }, [clearUnlistPendingReview, fetchSkills, notifyReviewOutcomeIfNeeded, rememberOwnPublishListedEvent, removePublishedSkillFromUnlistPage, shouldSkipOwnPublishListedToast, skills, t]);

  const safeSkills = Array.isArray(skills) ? skills : [];
  const globalSkillIdSet = useMemo(
    () => new Set(defaultAgentSkills.map((skillId) => normalizeSkillKey(skillId))),
    [defaultAgentSkills],
  );
  const skillsWithEnabled = useMemo(
    () => safeSkills.map((skill) => {
      const inGlobalDefaults = globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill));
      const hasAgents = (skill.agents?.length ?? 0) > 0;
      return {
        ...skill,
        enabled: inGlobalDefaults || hasAgents,
      };
    }),
    [globalSkillIdSet, safeSkills],
  );
  const globalSkillCount = useMemo(
    () => countSelectedCatalogSkills(safeSkills, defaultAgentSkills),
    [safeSkills, defaultAgentSkills],
  );
  const selectedSkillDetail = useMemo(() => {
    if (!selectedSkill) return null;
    return skillsWithEnabled.find((skill) => skill.id === selectedSkill.id) ?? selectedSkill;
  }, [selectedSkill, skillsWithEnabled]);
  const filteredSkills = skillsWithEnabled.filter((skill) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      q.length === 0 ||
      skill.name.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q) ||
      skill.id.toLowerCase().includes(q) ||
      (skill.slug || '').toLowerCase().includes(q) ||
      (skill.author || '').toLowerCase().includes(q);

    let matchesSource = true;
    if (selectedSource === 'built-in') {
      matchesSource = !!skill.isBundled;
    } else if (selectedSource === 'marketplace') {
      matchesSource = isServerMarketplaceSkill(skill);
    }

    return matchesSearch && matchesSource;
  }).sort((a, b) => {
    if (a.enabled && !b.enabled) return -1;
    if (!a.enabled && b.enabled) return 1;
    if (a.isCore && !b.isCore) return -1;
    if (!a.isCore && b.isCore) return 1;
    return a.name.localeCompare(b.name);
  });

  const sourceStats = {
    all: safeSkills.length,
    builtIn: safeSkills.filter(s => s.isBundled).length,
    marketplace: safeSkills.filter(isServerMarketplaceSkill).length,
  };

  const closeSkillSideSheets = useCallback(() => {
    setInstallSheetOpen(false);
    setVersionSheetOpen(false);
    setManagePublishSheetOpen(false);
  }, []);

  const openAgentSelector = useCallback((skill: Skill) => {
    setSkillForAgentSelector(skill);
    setAgentSelectorOpen(true);
    startTransition(() => closeSkillSideSheets());
  }, [closeSkillSideSheets]);

  const openGlobalSkillsDialog = useCallback(() => {
    closeSkillSideSheets();
    setGlobalSkillsOpen(true);
  }, [closeSkillSideSheets]);

  const handleToggle = useCallback(async (skillId: string, enable: boolean) => {
    const skill = skillsWithEnabled.find((s) => s.id === skillId);
    if (!skill) return;

    try {
      if (enable) {
        // Open agent selector to choose which agents to enable this skill for
        openAgentSelector(skill);
      } else {
        // Disable must clear both layers: per-agent allowlists and defaults when present.
        // updateSkillAgents([]) is opt-out only and no longer removes agents.defaults.skills.
        const currentlyGlobal = globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill));
        const disablePlan = planSkillDisableActions({ currentlyGlobal });
        if (disablePlan.updateGlobal) {
          const nextDefaults = normalizeSkillsSelectionForPersist(
            removeCatalogSkillFromSelection(skill, defaultAgentSkills, skillsWithEnabled),
            skillsWithEnabled,
          );
          await updateGlobalAgentSkills(nextDefaults);
        }
        if (disablePlan.updateAgents) {
          await updateSkillAgents(skillId, []);
        }
        toast.success(t('toast.disabled'));
        await Promise.all([fetchSkills(), fetchAgents()]);
      }
    } catch (err) {
      toast.appError(err);
    }
  }, [
    skillsWithEnabled,
    updateSkillAgents,
    updateGlobalAgentSkills,
    defaultAgentSkills,
    globalSkillIdSet,
    t,
    fetchSkills,
    fetchAgents,
    openAgentSelector,
  ]);

  const handleAgentSelectorSave = async (
    skill: Skill,
    payload: { agentIds: string[]; draftIsGlobal: boolean },
  ) => {
    const skillId = skill.id;
    const currentlyGlobal = globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill));
    // Always compare against real per-agent assignments — global defaults alone
    // must not pretend "everyone is selected" (full opt-out is a valid state).
    const effectivePersistedAgentIds = resolveAgentIdSelection(skill.agents || [], allAgents);
    const plan = planAgentSelectorPersistActions({
      currentlyGlobal,
      draftIsGlobal: payload.draftIsGlobal,
      draftAgentIds: payload.agentIds,
      effectivePersistedAgentIds,
    });

    if (!plan.updateGlobal && !plan.updateAgents) return;

    setAgentSelectorLoading(true);
    let agentsWriteFailedAfterGlobal = false;
    try {
      if (plan.updateGlobal) {
        const next = normalizeSkillsSelectionForPersist(
          payload.draftIsGlobal
            ? addCatalogSkillToSelection(skill, defaultAgentSkills, skillsWithEnabled)
            : removeCatalogSkillFromSelection(skill, defaultAgentSkills, skillsWithEnabled),
          skillsWithEnabled,
        );
        await updateGlobalAgentSkills(next);
      }
      if (plan.updateAgents) {
        try {
          await updateSkillAgents(skillId, payload.agentIds);
        } catch (agentsError) {
          if (plan.updateGlobal) {
            agentsWriteFailedAfterGlobal = true;
            toast.error(t('toast.globalSavedAgentsFailed', {
              defaultValue: 'Global saved; assignments failed',
            }));
          }
          throw agentsError;
        }
      }
      await Promise.all([fetchSkills(), fetchAgents()]);
      const toastKey = resolveAgentSelectorSaveToastKey({
        updateGlobal: plan.updateGlobal,
        draftIsGlobal: payload.draftIsGlobal,
      });
      toast.success(t(`toast.${toastKey}`));
    } catch (error) {
      if (!agentsWriteFailedAfterGlobal) {
        toast.error(t('toast.failedSaveSkillAgents', { defaultValue: 'Save failed' }));
      }
      throw error;
    } finally {
      setAgentSelectorLoading(false);
    }
  };

  const hasInstalledSkills = safeSkills.some((s) => !s.isBundled);

  const handleOpenSkillsFolder = useCallback(async () => {
    try {
      const skillsDir = await hostApi.openclaw.getSkillsDir();
      if (!skillsDir) {
        throw new Error('Skills directory not available');
      }
      const result = await hostApi.shell.openPath(skillsDir);
      if (result) {
        if (
          result.toLowerCase().includes('no such file') ||
          result.toLowerCase().includes('not found') ||
          result.toLowerCase().includes('failed to open')
        ) {
          toast.error(t('toast.failedFolderNotFound'));
        } else {
          throw new Error(result);
        }
      }
    } catch (err) {
      toast.error(t('toast.failedOpenFolder') + ': ' + String(err));
    }
  }, [t]);

  const handleOpenSkillFolder = useCallback(
    async (skill: Skill) => {
      try {
        const result = await hostApi.skills.clawhubOpenSkillPath({
          skillKey: skill.id,
          slug: skill.slug,
          baseDir: skill.baseDir,
        });
        if (!result.success) {
          throw new Error(result.error || 'Failed to open folder');
        }
      } catch (err) {
        toast.error(t('toast.failedOpenActualFolder') + ': ' + String(err));
      }
    },
    [t],
  );

  const [skillsDirPath, setSkillsDirPath] = useState('~/.openclaw/skills');

  useEffect(() => {
    hostApi.openclaw
      .getSkillsDir()
      .then((dir) => setSkillsDirPath(dir))
      .catch(console.error);
  }, []);

  const handleUninstall = useCallback(async (slug: string) => {
    try {
      await uninstallSkill(slug);
      toast.success(t('toast.uninstalled'));
    } catch (err) {
      toast.error(t('toast.failedUninstall') + ': ' + String(err));
    }
  }, [uninstallSkill, t]);

  const resolvePublishErrDetail = useCallback(
    (detail: string) => {
      if (detail === 'SKILL_UPLOAD_WS_NO_BEARER_TOKEN') return t('toast.publishNoToken');
      if (detail === 'SKILL_UPLOAD_WS_CLIENT_TIMEOUT') return t('toast.publishTimeout');
      if (detail === 'SKILL_UPLOAD_WS_CLOSED') return t('toast.publishClosed');
      if (detail === 'SKILLS_MARKETPLACE_NO_BASE_URL') return t('toast.publishNoBaseUrl');
      return detail;
    },
    [t],
  );

  const [confirmDialogState, setConfirmDialogState] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'destructive';
  } | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  // In-app confirmation (replaces window.confirm) so dialogs match the client UI and
  // keep focus inside the renderer. Returns a promise that resolves with the choice.
  const requestConfirm = useCallback((options: {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'destructive';
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

  const submitPublishMeta = useCallback(async () => {
    if (publishSkillBusy) return;
    const author = publishAuthor.trim() || publishUsername.trim();
    const version = publishVersion.trim();
    if (!author) {
      setPublishMetaError(t('publishMeta.authorRequired'));
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      setPublishMetaError(t('publishMeta.versionInvalid'));
      return;
    }
    const filePath = publishMetaFilePath;
    if (!filePath) {
      setPublishMetaError(t('publishMeta.fileMissing'));
      return;
    }
    setPublishMetaError('');
    setPublishSkillBusy(true);
    type WsIpc = {
      success: boolean;
      cancelled?: boolean;
      result?: {
        ok: boolean;
        skill_id?: string;
        request_id?: number;
        review_no?: string;
        status?: string;
        error?: string;
        code?: string;
        display_name?: string;
        version?: string;
        version_base?: string;
        existing_skill_ids?: string[];
      };
      error?: string;
      pickedPath?: string;
    };
    const category = publishCategory.trim() || DEFAULT_SKILL_CATEGORY;
    const run = (extra: { overwriteSameName?: boolean }) =>
      hostApi.skills.uploadMarketplaceZip({ filePath, author, version, category, ...extra }) as Promise<WsIpc>;
    const closeDialog = () => setPublishMetaOpen(false);
    try {
      let ipc = await run({});
      if (!ipc.success) {
        toast.error(t('toast.publishIpcError', { detail: resolvePublishErrDetail(ipc.error || '') }));
        closeDialog();
        return;
      }
      if (!ipc.result) {
        toast.error(t('toast.publishIpcError', { detail: resolvePublishErrDetail('') }));
        closeDialog();
        return;
      }
      let r = ipc.result;
      if (!r.ok && r.code === 'VET_UNAVAILABLE') {
        toast.error(t('publishSkill.vetUnavailable'));
        closeDialog();
        return;
      }
      if (!r.ok && r.code === 'INVALID_VERSION') {
        setPublishMetaError(r.error || t('publishMeta.versionRejected'));
        return;
      }
      if (!r.ok && r.code === 'DUPLICATE_SKILL_NAME') {
        const proceedOverwrite = await requestConfirm({
          title: t('publishSkill.duplicateTitle'),
          message: t('publishSkill.duplicateConfirm', { name: r.display_name || '—', ids: formatSkillIdList(r.existing_skill_ids) }),
          confirmLabel: t('confirmActions.confirm'),
          cancelLabel: t('confirmActions.cancel'),
        });
        if (proceedOverwrite) {
          ipc = await run({ overwriteSameName: true });
          if (!ipc.success) {
            toast.error(t('toast.publishIpcError', { detail: resolvePublishErrDetail(ipc.error || '') }));
            closeDialog();
            return;
          }
          if (!ipc.result) {
            toast.error(t('toast.publishIpcError', { detail: resolvePublishErrDetail('') }));
            closeDialog();
            return;
          }
          r = ipc.result;
          if (!r.ok && r.code === 'INVALID_VERSION') {
            setPublishMetaError(r.error || t('publishMeta.versionRejected'));
            return;
          }
        } else {
          toast.info(t('publishSkill.duplicateCancelled'));
          closeDialog();
          return;
        }
      }
      if (!r.ok && r.code === 'PENDING_PUBLISH_REVIEW') {
        const reviewNo = r.review_no || String(r.request_id || '—');
        setPublishPending((prev) => upsertPublishPendingRecord(prev, {
          reviewNo,
          requestId: r.request_id,
          skillId: r.skill_id,
          displayName: r.display_name,
          version: r.version,
          versionBase: r.version_base,
        }));
        setManagePublishSheetOpen(true);
        toast.error(t('publishSkill.pendingReviewExists', { id: reviewNo }));
        closeDialog();
        return;
      }
      if (r.ok) {
        if (r.code === 'PENDING_REVIEW' || r.status === 'pending') {
          const requestId = r.request_id;
          const reviewNo = r.review_no || String(requestId || '—');
          setPublishPending((prev) => upsertPublishPendingRecord(prev, {
            reviewNo,
            requestId,
            skillId: r.skill_id,
            displayName: r.display_name,
            version: r.version,
            versionBase: r.version_base,
          }));
          setPublishRejected((prev) => {
            const rejectedKey = findPublishReviewKey(prev, r.skill_id, requestId);
            if (!rejectedKey) return prev;
            const next = { ...prev };
            delete next[rejectedKey];
            return next;
          });
          setManagePublishSheetOpen(true);
          toast.success(t('toast.publishPendingReview', { id: reviewNo }));
          if (typeof requestId === 'number') {
            trackPendingReviewRequestId(requestId);
          }
        } else {
          toast.success(t('toast.publishOk', { id: r.skill_id || '—' }));
          if (r.skill_id) {
            setPublishedSkills((prev) => {
              if (prev.some((skill) => skill.skill_id === r.skill_id)) {
                return prev.map((skill) => skill.skill_id === r.skill_id
                  ? {
                    ...skill,
                    display_name: r.display_name || skill.display_name,
                    version: r.version || skill.version,
                    version_base: r.version_base || skill.version_base,
                  }
                  : skill);
              }
              return [{
                skill_id: r.skill_id!,
                display_name: r.display_name,
                description: r.skill_id,
                version: r.version,
                version_base: r.version_base,
              }, ...prev];
            });
          }
        }
        closeDialog();
      } else {
        toast.error(t('toast.publishFail', { detail: resolvePublishErrDetail(r.error || '') }));
        closeDialog();
      }
    } catch (err) {
      toast.error(t('toast.publishFail', { detail: String(err) }));
      closeDialog();
    } finally {
      setPublishSkillBusy(false);
    }
  }, [publishSkillBusy, publishAuthor, publishUsername, publishVersion, publishCategory, publishMetaFilePath, resolvePublishErrDetail, t, requestConfirm]);

  const handlePickPublishZip = useCallback(async () => {
    if (publishSkillBusy) return;
    try {
      const picked = await hostApi.dialog.open({
        title: t('publishMeta.pickTitle'),
        properties: ['openFile'],
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (picked.canceled || !picked.filePaths?.[0]) return;
      const filePath = picked.filePaths[0];
      setPublishMetaFilePath(filePath);
      setPublishAuthor('');
      setPublishVersion('');
      setPublishRemoteVersion('');
      setPublishMetaError('');
      try {
        const metaRes = await hostApi.skills.getPublishMeta({ filePath });
        if (metaRes.success && metaRes.meta) {
          const username = (metaRes.meta.username || '').trim();
          const remoteVersion = (metaRes.meta.remoteVersion || '').trim();
          if (username) {
            setPublishUsername(username);
            setPublishAuthor((prev) => (prev.trim() ? prev : username));
          }
          if (remoteVersion) setPublishRemoteVersion(remoteVersion);
        }
      } catch {
        // Non-fatal: the dialog still works without prefilled defaults.
      }
    } catch (err) {
      toast.error(t('toast.publishFail', { detail: String(err) }));
    }
  }, [publishSkillBusy, t]);

  const handlePublishSkill = useCallback(() => {
    if (publishSkillBusy || publishMetaOpen) return;
    setPublishMetaFilePath('');
    setPublishAuthor('');
    setPublishVersion('');
    setPublishCategory(DEFAULT_SKILL_CATEGORY);
    setPublishUsername('');
    setPublishRemoteVersion('');
    setPublishMetaError('');
    setPublishMetaOpen(true);
  }, [publishSkillBusy, publishMetaOpen]);

  const loadPublishedMarketplaceSkills = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setPublishedSkillsLoading(true);
    }
    try {
      const res = await hostApi.skills.listPublishedMarketplace();
      if (!res.success) {
        throw new Error(res.error || 'list published skills failed');
      }
      const nextSkills = dedupePublishedSkillsByVersionBase((res.skills ?? []) as PublishedMarketplaceSkill[]);
      const publishedIds = new Set(nextSkills.map((skill) => skill.skill_id));
      const publishedByBase = new Map(nextSkills.map((skill) => [publishedSkillVersionBase(skill), skill]));
      setPublishedSkills(nextSkills);
      setPublishPending((prev) => {
        const next = { ...prev };
        for (const [key, pending] of Object.entries(prev)) {
          if (pending.skillId && publishedIds.has(pending.skillId)) {
            delete next[key];
            continue;
          }
          const pendingBase = pending.versionBase?.trim().toLowerCase();
          if (!pendingBase) continue;
          const published = publishedByBase.get(pendingBase);
          if (!published) continue;
          const versionCompare = compareSkillVersionText(pending.version, published.version);
          if (!pending.version || versionCompare === null || versionCompare <= 0) {
            delete next[key];
          }
        }
        return next;
      });
    } catch (err) {
      if (!options?.silent) {
        toast.error(t('toast.listPublishedFail', { detail: String(err) }));
      }
      setPublishedSkills([]);
    } finally {
      if (!options?.silent) {
        setPublishedSkillsLoading(false);
      }
    }
  }, [t]);

  const syncMarketplaceReviewRequests = useCallback(async () => {
    try {
      const res = await hostApi.skills.listMarketplaceReviewRequests();
      if (!res.success) {
        throw new Error(res.error || 'list marketplace review requests failed');
      }
      const requests = (res.requests ?? []) as MarketplaceReviewRequest[];

      const { notifications, nextTrackedPendingIds } = collectMissedReviewNotifications(
        requests,
        readTrackedPendingReviewRequestIds(),
        readNotifiedReviewOutcomes(),
      );
      persistMissedReviewNotificationState(notifications, nextTrackedPendingIds);

      let shouldRefreshPublishedSkills = false;
      let shouldRefreshInstalledSkills = false;
      for (const notification of notifications) {
        const name = notification.displayName || notification.skillId || '—';
        showReviewOutcomeToast({
          requestType: notification.requestType,
          status: notification.status,
          name,
          version: notification.version,
          comments: notification.comments,
        });

        if (notification.requestType === 'unlist' && notification.status === 'approved' && notification.skillId) {
          removePublishedSkillFromUnlistPage(notification.skillId);
          shouldRefreshInstalledSkills = true;
        }
        if (notification.requestType === 'unlist' && notification.status === 'rejected' && notification.skillId) {
          clearUnlistPendingReview({
            skillId: notification.skillId,
            requestId: notification.requestId,
            rejectedComment: notification.comments,
          });
        }
        if (notification.requestType === 'publish' && notification.status === 'approved') {
          shouldRefreshPublishedSkills = true;
          shouldRefreshInstalledSkills = true;
        }
      }
      if (shouldRefreshPublishedSkills) {
        void loadPublishedMarketplaceSkills({ silent: true });
      }
      if (shouldRefreshInstalledSkills) {
        void fetchSkills();
      }

      setPublishPending((prev) => {
        const next = buildPublishPendingFromReviewRequests(requests);
        for (const pending of Object.values(prev)) {
          if (typeof pending.requestId === 'number') continue;
          const key = publishPendingIdentity(pending);
          if (!next[key]) {
            next[key] = pending;
          }
        }
        return next;
      });

      setPublishRejected((prev) => {
        const next = { ...prev };
        for (const request of requests) {
          const requestType = request.request_type || 'publish';
          if (requestType !== 'publish') continue;
          const requestId = request.id;
          const skillId = request.published_skill_id?.trim();
          const existingKey = findPublishReviewKey(next, skillId, requestId);
          if (request.status === 'rejected') {
            if (dismissedReviewRequestIds.has(requestId)) {
              if (existingKey) {
                delete next[existingKey];
              }
              continue;
            }
            const key = existingKey || publishReviewKey(skillId, requestId);
            next[key] = {
              requestId,
              skillId,
              displayName: request.display_name,
              comments: request.review_comments?.trim(),
            };
          } else if (existingKey) {
            delete next[existingKey];
          }
        }
        return next;
      });

      setUnlistPending((prev) => {
        const next = { ...prev };
        for (const request of requests) {
          if (request.request_type !== 'unlist') continue;
          const skillId = request.target_skill_id?.trim() || request.published_skill_id?.trim();
          if (!skillId) continue;
          if (request.status === 'pending') {
            next[skillId] = {
              reviewNo: request.review_no || String(request.id),
              requestId: request.id,
            };
          } else {
            delete next[skillId];
          }
        }
        return next;
      });

      setUnlistRejected((prev) => {
        const next = { ...prev };
        for (const request of requests) {
          if (request.request_type !== 'unlist') continue;
          const skillId = request.target_skill_id?.trim() || request.published_skill_id?.trim();
          if (!skillId) continue;
          if (request.status === 'rejected') {
            next[skillId] = request.review_comments?.trim() || '';
          } else {
            delete next[skillId];
          }
        }
        return next;
      });
    } catch {
      // Review status sync is a best-effort offline compensation path.
    }
  }, [
    clearUnlistPendingReview,
    dismissedReviewRequestIds,
    fetchSkills,
    loadPublishedMarketplaceSkills,
    removePublishedSkillFromUnlistPage,
    showReviewOutcomeToast,
  ]);

  const dismissPublishRejectedReview = useCallback((key: string, requestId?: number) => {
    if (typeof requestId === 'number') {
      setDismissedReviewRequestIds((prev) => {
        const next = new Set(prev);
        next.add(requestId);
        writeDismissedReviewRequestIds(next);
        return next;
      });
    }
    setPublishRejected((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const handleManagePublishSheetOpenChange = useCallback((open: boolean) => {
    setManagePublishSheetOpen(open);
    if (open) {
      void loadPublishedMarketplaceSkills();
      void syncMarketplaceReviewRequests();
    }
  }, [loadPublishedMarketplaceSkills, syncMarketplaceReviewRequests]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPublishedMarketplaceSkills({ silent: true });
      void syncMarketplaceReviewRequests();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPublishedMarketplaceSkills, syncMarketplaceReviewRequests]);

  useEffect(() => {
    return subscribeHostEvent('skill:review-sync-needed', () => {
      void loadPublishedMarketplaceSkills({ silent: true });
      void syncMarketplaceReviewRequests();
    });
  }, [loadPublishedMarketplaceSkills, syncMarketplaceReviewRequests]);


  const requestUnlistSkill = useCallback(async (skillId: string) => {
    const confirmed = await requestConfirm({
      title: t('unlistSkill.confirmTitle'),
      message: t('unlistSkill.confirm', { id: skillId }),
      confirmLabel: t('confirmActions.confirm'),
      cancelLabel: t('confirmActions.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    setUnlistRequesting((prev) => ({ ...prev, [skillId]: true }));
    try {
      const res = await hostApi.skills.requestMarketplaceUnlist({ skillId });
      if (!res.success) {
        throw new Error(res.error || 'request unlist failed');
      }
      const unlistResult = res.result as { request_id?: number; review_no?: string; status?: string } | undefined;
      const requestId = unlistResult?.request_id;
      const reviewNo = unlistResult?.review_no || String(requestId || '—');
      setUnlistPending((prev) => ({ ...prev, [skillId]: { reviewNo, requestId } }));
      setUnlistRejected((prev) => {
        const next = { ...prev };
        delete next[skillId];
        return next;
      });
      toast.success(t('toast.unlistPendingReview', { id: reviewNo }));
      if (typeof requestId === 'number') {
        trackPendingReviewRequestId(requestId);
      }
    } catch (err) {
      toast.error(t('toast.unlistRequestFail', { detail: String(err) }));
    } finally {
      setUnlistRequesting((prev) => {
        const next = { ...prev };
        delete next[skillId];
        return next;
      });
    }
  }, [t, requestConfirm]);

  const handleCancelPublishRequest = useCallback(async (key: string, requestId?: number) => {
    if (typeof requestId !== 'number' || !Number.isFinite(requestId)) {
      return;
    }
    const confirmed = await requestConfirm({
      title: t('skillLifecycle.cancelPublishTitle'),
      message: t('skillLifecycle.cancelPublishConfirm'),
      confirmLabel: t('confirmActions.confirm'),
      cancelLabel: t('confirmActions.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    setCancelingReviewIds((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await hostApi.skills.cancelMarketplaceReviewRequest({ requestId });
      if (!res.success) {
        throw new Error(res.error || 'cancel request failed');
      }
      setPublishPending((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
      toast.success(t('toast.cancelPublishOk'));
    } catch (err) {
      toast.error(t('toast.cancelRequestFail', { detail: String(err) }));
    } finally {
      setCancelingReviewIds((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  }, [t, requestConfirm]);

  const handleCancelUnlistRequest = useCallback(async (skillId: string, requestId?: number) => {
    if (typeof requestId !== 'number' || !Number.isFinite(requestId)) {
      return;
    }
    const confirmed = await requestConfirm({
      title: t('skillLifecycle.cancelUnlistTitle'),
      message: t('skillLifecycle.cancelUnlistConfirm'),
      confirmLabel: t('confirmActions.confirm'),
      cancelLabel: t('confirmActions.cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    setCancelingReviewIds((prev) => ({ ...prev, [requestId]: true }));
    try {
      const res = await hostApi.skills.cancelMarketplaceReviewRequest({ requestId });
      if (!res.success) {
        throw new Error(res.error || 'cancel request failed');
      }
      setUnlistPending((prev) => {
        const next = { ...prev };
        delete next[skillId];
        return next;
      });
      toast.success(t('toast.cancelUnlistOk'));
    } catch (err) {
      toast.error(t('toast.cancelRequestFail', { detail: String(err) }));
    } finally {
      setCancelingReviewIds((prev) => {
        const next = { ...prev };
        delete next[requestId];
        return next;
      });
    }
  }, [t, requestConfirm]);

  const displayedPublishedSkills = useMemo(
    () => dedupePublishedSkillsByVersionBase(publishedSkills),
    [publishedSkills],
  );
  const publishedSkillIds = new Set(displayedPublishedSkills.map((skill) => skill.skill_id));
  const publishPendingRows = Object.entries(publishPending)
    .filter(([, pending]) => {
      if (pending.skillId && publishedSkillIds.has(pending.skillId)) {
        return false;
      }
      const pendingBase = pending.versionBase?.trim().toLowerCase();
      if (!pendingBase) return true;
      const published = displayedPublishedSkills.find((skill) => publishedSkillVersionBase(skill) === pendingBase);
      if (!published) return true;
      if (!pending.version) return true;
      return compareSkillVersionText(pending.version, published.version) === 1;
    })
    .sort(([, a], [, b]) => (a.requestId ?? Number.MAX_SAFE_INTEGER) - (b.requestId ?? Number.MAX_SAFE_INTEGER));
  const publishRejectedRows = Object.entries(publishRejected)
    .filter(([, rejected]) => !rejected.skillId || !publishedSkillIds.has(rejected.skillId));
  const hasSkillLifecycleRows =
    publishPendingRows.length > 0 ||
    publishRejectedRows.length > 0 ||
    displayedPublishedSkills.length > 0;

  if (loading) {
    return (
      <div className="flex flex-col h-full items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div
      data-testid="skills-tab"
      data-marketplace-available={marketplaceAvailable}
      className="flex flex-col h-full min-h-0 overflow-hidden"
    >
      <div className="w-full flex flex-col h-full">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 shrink-0 gap-4">
          <div>
            <h1 className="text-3xl font-serif text-foreground mb-6 font-normal tracking-tight" style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif' }}>
              {t('title')}
            </h1>
            <p className="text-subtitle text-foreground/70 font-medium">{t('subtitle')}</p>
          </div>

          <div className="flex items-center gap-3 md:mt-2">
            {hasInstalledSkills && (
              <button
                onClick={handleOpenSkillsFolder}
                className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors shrink-0 text-[13px] font-medium px-4 h-8 rounded-full border border-black/10 dark:border-white/10 flex items-center justify-center text-foreground/80 hover:text-foreground"
              >
                <FolderOpen className="h-4 w-4 mr-2" />
                {t('openFolder')}
              </button>
            )}
          </div>
        </div>

        {/* Gateway Status Banner */}
        {showGatewayBanner && gatewayBannerState !== 'none' && (
          <div
            data-testid="skills-gateway-banner"
            data-state={gatewayBannerState}
            className="mb-6 p-4 rounded-xl border border-yellow-500/50 bg-yellow-500/10 flex items-center gap-3"
          >
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            <span className="text-sm font-medium text-yellow-700 dark:text-yellow-400">{t('gatewayWarning')}</span>
          </div>
        )}

        {/* Sub Navigation and Actions */}
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-black/10 dark:border-white/10 pb-4 mb-4 shrink-0 gap-4">
          <div className="flex items-center flex-wrap gap-4 text-[14px]">
            <div className="relative group flex items-center bg-black/5 dark:bg-white/5 rounded-full px-3 py-1.5 focus-within:bg-black/10 transition-colors border border-transparent focus-within:border-black/10 dark:focus-within:border-white/10 mr-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                placeholder={t('search')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="ml-2 bg-transparent outline-none w-28 md:w-40 font-normal placeholder:text-foreground/50 text-[13px] text-foreground"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-foreground/50 hover:text-foreground shrink-0 ml-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-6">
              <button
                onClick={() => setSelectedSource('all')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'all' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.all', { count: sourceStats.all })}
              </button>
              <button
                onClick={() => setSelectedSource('built-in')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'built-in' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.builtIn', { count: sourceStats.builtIn })}
              </button>
              <button
                onClick={() => setSelectedSource('marketplace')}
                className={cn("font-medium transition-colors flex items-center gap-1.5", selectedSource === 'marketplace' ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t('filter.marketplace', { count: sourceStats.marketplace })}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              data-testid="global-skills-button"
              onClick={openGlobalSkillsDialog}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none inline-flex items-center gap-1.5"
            >
              <Globe className="h-3.5 w-3.5" />
              {t('actions.globalSkills', { count: globalSkillCount })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="skills-lifecycle-button"
              onClick={() => handleManagePublishSheetOpenChange(true)}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none"
            >
              {t('actions.managePublishSkill')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="skills-install-button"
              onClick={() => {
                setInstallSheetOpen(true);
              }}
              disabled={publishSkillBusy}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none"
            >
              {t('actions.installSkill')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="skills-version-button"
              onClick={() => {
                setVersionSheetOpen(true);
              }}
              disabled={publishSkillBusy}
              className="h-8 text-[13px] font-medium rounded-md px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none"
            >
              {t('actions.upgradeRollbackSkill')}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchSkills}
              disabled={publishSkillBusy}
              className="h-8 w-8 ml-1 rounded-md border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-muted-foreground hover:text-foreground"
              title={t('refresh')}
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pr-2 pb-10 min-h-0 -mr-2">
          {error && (
            <div className="mb-4 p-4 rounded-xl border border-destructive/50 bg-destructive/10 text-destructive text-sm font-medium flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>
                {SKILL_FETCH_ERROR_KEYS.has(error)
                  ? t(`toast.${error}`, { path: skillsDirPath })
                  : error}
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {filteredSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <Puzzle className="h-10 w-10 mb-4 opacity-50" />
                <p>{searchQuery ? t('noSkillsSearch') : t('noSkillsAvailable')}</p>
              </div>
            ) : (
              filteredSkills.map((skill) => (
                <div
                  key={skill.id}
                  data-testid="skill-list-item"
                  className="group flex flex-col sm:flex-row sm:items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer border border-transparent hover:border-black/5 dark:hover:border-white/10"
                  onClick={() => setSelectedSkill(skill)}
                >
                  {/* Left: Icon and Info */}
                  <div className="flex items-start gap-3 flex-1 overflow-hidden min-w-0">
                    <div className="h-11 w-11 shrink-0 flex items-center justify-center text-2xl bg-gradient-to-br from-black/5 to-black/10 dark:from-white/5 dark:to-white/10 border border-black/5 dark:border-white/10 rounded-xl overflow-hidden shadow-sm">
                      {skill.icon || '🧩'}
                    </div>
                    <div className="flex flex-col overflow-hidden min-w-0 flex-1 gap-0.5">
                      {/* 第 1 行：名称 + 版本 */}
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-[15px] font-semibold text-foreground truncate">
                          {skill.name}
                          {formatSkillVersionLabel(skill.version) ? (
                            <span className="ml-1.5 text-[13px] font-mono font-normal text-muted-foreground tabular-nums">
                              ({formatSkillVersionLabel(skill.version)})
                            </span>
                          ) : null}
                        </h3>
                        {isServerMarketplaceSkill(skill) ? (
                          <SkillCategoryBadge category={skill.marketplace?.category} />
                        ) : null}
                        {skill.isCore && (
                          <Badge variant="outline" className="h-4 px-1.5 shrink-0 text-[10px] border-yellow-500/50 text-yellow-600 dark:text-yellow-400">
                            <Lock className="h-2.5 w-2.5 mr-1" />
                            Core
                          </Badge>
                        )}
                      </div>

                      {/* 第 2 行：摘要 */}
                      <p className="text-[13px] text-muted-foreground line-clamp-1 leading-relaxed">
                        {getSkillListDescription(skill, t)}
                      </p>

                      {/* 第 3 行：目录类型 + 路径 */}
                      <SkillDirectoryLine skill={skill} t={t} />
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-3 shrink-0 mt-3 sm:mt-0 sm:ml-4" onClick={e => e.stopPropagation()}>
                    {/* Agents：图标 + 数量；全局技能显示 Globe */}
                    {(() => {
                      const inGlobal = globalSkillIdSet.has(canonicalSkillKeyFromSkill(skill));
                      const agentCount = skill.agents?.length ?? 0;
                      const agentsTitle = inGlobal && agentCount === 0
                        ? t('skills:agentSelector.globalOptOutTitle', {
                          defaultValue: 'Global default · no current agents (new agents inherit)',
                        })
                        : inGlobal
                          ? t('skills:agentSelector.globalAssignedTitle', {
                            count: agentCount,
                            defaultValue: `Global · ${agentCount} agents`,
                          })
                          : t('skills:agentSelector.assignedAgents', {
                            count: agentCount,
                            defaultValue: `Assigned to ${agentCount} agents`,
                          });
                      return (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openAgentSelector(skill)}
                          data-testid="skill-agent-assign-button"
                          className={cn(
                            'h-8 px-2 gap-1.5 shrink-0 transition-all',
                            agentCount > 0 || inGlobal
                              ? 'text-green-600 dark:text-green-400 hover:bg-green-500/10 hover:text-green-700 dark:hover:text-green-300'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          title={agentsTitle}
                        >
                          {inGlobal ? (
                            <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden data-testid="skill-agent-global-badge" />
                          ) : (
                            <Users className="h-4 w-4 shrink-0" />
                          )}
                          <span className="text-xs font-medium tabular-nums min-w-[1ch]">
                            {agentCount}
                          </span>
                        </Button>
                      );
                    })()}

                    <div className="flex items-center gap-2 pl-2 border-l border-border">
                      <span className="text-xs text-muted-foreground">
                        {skill.enabled ? t('detail.enabled', { defaultValue: 'Enabled' }) : t('detail.disabled', { defaultValue: 'Disabled' })}
                      </span>
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={(checked) => handleToggle(skill.id, checked)}
                        disabled={skill.isCore}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {installSheetOpen ? (
        <ServerMarketplaceSheet
          onClose={() => setInstallSheetOpen(false)}
          safeSkills={safeSkills}
          skillsDirPath={skillsDirPath}
          catalogRefreshTrigger={catalogRefreshTrigger}
        />
      ) : null}

      {versionSheetOpen ? (
        <ServerMarketplaceSheet
          onClose={() => setVersionSheetOpen(false)}
          safeSkills={safeSkills}
          skillsDirPath={skillsDirPath}
          catalogRefreshTrigger={catalogRefreshTrigger}
          mode="version"
        />
      ) : null}

      {managePublishSheetOpen ? (
        <SkillSideSheetShell
          onClose={() => handleManagePublishSheetOpenChange(false)}
          title={t('skillLifecycle.title')}
          subtitle={t('skillLifecycle.subtitle')}
          testId="skills-lifecycle-sheet"
          exitTestId="skills-publish-sheet-exit"
          maxWidthClass="sm:max-w-[520px]"
          headerExtra={(
            <Button
              variant="outline"
              size="sm"
              onClick={handlePublishSkill}
              disabled={publishSkillBusy}
              className="mt-5 h-8 text-[13px] font-medium rounded-md px-3 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none inline-flex items-center gap-1.5"
            >
              {publishSkillBusy ? <LoadingSpinner size="sm" /> : <Upload className="h-3.5 w-3.5" />}
              {t('skillLifecycle.requestPublish')}
            </Button>
          )}
        >
          <div className="px-6 py-4">
            {publishedSkillsLoading ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <LoadingSpinner size="lg" />
                <p className="mt-4 text-sm">{t('skillLifecycle.loading')}</p>
              </div>
            ) : !hasSkillLifecycleRows ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <Upload className="h-10 w-10 mb-4 opacity-50" />
                <p>{t('skillLifecycle.empty')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {publishPendingRows.map(([key, pending]) => (
                  <div
                    key={key}
                    className="flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-black/5 dark:border-white/5 last:border-0"
                  >
                    <div className="min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border-0 shadow-none">
                          {t('skillLifecycle.publishStatus')}
                        </Badge>
                        <h3 className="truncate text-[15px] font-semibold text-foreground">
                          {pending.displayName || pending.skillId || pending.reviewNo}
                        </h3>
                        {pending.version && (
                          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 py-0 text-[10px] font-mono font-medium bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                            v{pending.version}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
                        {t('skillLifecycle.publishPendingStatus', { id: pending.reviewNo })}
                      </p>
                    </div>
                    {typeof pending.requestId === 'number' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCancelPublishRequest(key, pending.requestId)}
                        disabled={Boolean(cancelingReviewIds[pending.requestId])}
                        className="h-8 shrink-0 shadow-none"
                      >
                        {cancelingReviewIds[pending.requestId]
                          ? <LoadingSpinner size="sm" />
                          : t('skillLifecycle.cancelPublish')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled
                        className={PENDING_REVIEW_BUTTON_CLASS}
                      >
                        {t('skillLifecycle.pendingButton')}
                      </Button>
                    )}
                  </div>
                ))}
                {publishRejectedRows.map(([key, rejected]) => (
                  <div
                    key={key}
                    className="flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-black/5 dark:border-white/5 last:border-0"
                  >
                    <div className="min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-medium bg-destructive/10 text-destructive border-0 shadow-none">
                          {t('skillLifecycle.publishStatus')}
                        </Badge>
                        <h3 className="truncate text-[15px] font-semibold text-foreground">
                          {rejected.displayName || rejected.skillId || rejected.requestId || t('skillLifecycle.unknownSkill')}
                        </h3>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12px] text-destructive">
                        {rejected.comments
                          ? t('skillLifecycle.publishRejectedWithComments', { comments: rejected.comments })
                          : t('skillLifecycle.publishRejected')}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => dismissPublishRejectedReview(key, rejected.requestId)}
                      className="h-8 shrink-0 shadow-none"
                    >
                      {t('skillLifecycle.dismissRejected')}
                    </Button>
                  </div>
                ))}
                {displayedPublishedSkills.map((skill) => {
                  const busy = !!unlistRequesting[skill.skill_id];
                  const pending = unlistPending[skill.skill_id];
                  const rejectedComment = unlistRejected[skill.skill_id];
                  return (
                    <div
                      key={skill.skill_id}
                      className="flex flex-row items-center justify-between py-3.5 px-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-b border-black/5 dark:border-white/5 last:border-0"
                    >
                      <div className="min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="px-1.5 py-0 h-5 text-[10px] font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-0 shadow-none">
                            {t('skillLifecycle.publishedStatus')}
                          </Badge>
                          <h3 className="truncate text-[15px] font-semibold text-foreground">
                            {skill.display_name || skill.skill_id}
                          </h3>
                          {skill.version && (
                            <Badge variant="secondary" className="h-5 shrink-0 px-1.5 py-0 text-[10px] font-mono font-medium bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70">
                              v{skill.version}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-1 text-[13px] text-muted-foreground">
                          {skill.description || skill.skill_id}
                        </p>
                        {pending && (
                          <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">
                            {t('skillLifecycle.unlistPendingStatus', { id: pending.reviewNo })}
                          </p>
                        )}
                        {rejectedComment && !pending && (
                          <p className="mt-1 line-clamp-2 text-[12px] text-destructive">
                            {t('skillLifecycle.unlistRejectedComment', { comments: rejectedComment })}
                          </p>
                        )}
                      </div>
                      {pending ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleCancelUnlistRequest(skill.skill_id, pending.requestId)}
                          disabled={
                            typeof pending.requestId !== 'number' ||
                            Boolean(cancelingReviewIds[pending.requestId])
                          }
                          className="h-8 shrink-0 shadow-none"
                        >
                          {typeof pending.requestId === 'number' && cancelingReviewIds[pending.requestId]
                            ? <LoadingSpinner size="sm" />
                            : t('skillLifecycle.cancelUnlist')}
                        </Button>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void requestUnlistSkill(skill.skill_id)}
                          disabled={busy}
                          className="h-8 shrink-0 shadow-none"
                        >
                          {busy ? <LoadingSpinner size="sm" /> : t('skillLifecycle.requestUnlist')}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </SkillSideSheetShell>
      ) : null}

      {/* Skill Detail Dialog */}
      <GlobalSkillsDialog
        availableSkills={safeSkills}
        isOpen={globalSkillsOpen}
        onClose={() => setGlobalSkillsOpen(false)}
      />

      <PublishSkillMetaDialog
        open={publishMetaOpen}
        author={publishAuthor}
        version={publishVersion}
        category={publishCategory}
        fileName={publishMetaFilePath.split(/[/\\]/).pop() || undefined}
        authorPlaceholder={publishUsername || undefined}
        remoteVersion={publishRemoteVersion || undefined}
        error={publishMetaError}
        busy={publishSkillBusy}
        onAuthorChange={(value) => { setPublishAuthor(value); if (publishMetaError) setPublishMetaError(''); }}
        onVersionChange={(value) => { setPublishVersion(value); if (publishMetaError) setPublishMetaError(''); }}
        onCategoryChange={(value) => { setPublishCategory(value); if (publishMetaError) setPublishMetaError(''); }}
        onPickFile={() => void handlePickPublishZip()}
        onSubmit={() => void submitPublishMeta()}
        onCancel={() => { if (!publishSkillBusy) setPublishMetaOpen(false); }}
      />

      <SkillDetailDialog
        skill={selectedSkillDetail}
        isOpen={!!selectedSkillDetail}
        onClose={() => setSelectedSkill(null)}
        onToggle={(enabled) => {
          if (!selectedSkillDetail) return;
          if (enabled) {
            handleToggle(selectedSkillDetail.id, true);
            return;
          }
          void handleToggle(selectedSkillDetail.id, false);
        }}
        onUninstall={handleUninstall}
        onOpenFolder={handleOpenSkillFolder}
      />

      {/* Agent Selector Dialog */}
      <AgentSelectorDialog
        skill={skillForAgentSelector}
        isOpen={agentSelectorOpen}
        onClose={() => setAgentSelectorOpen(false)}
        onSave={async (payload) => {
          if (!skillForAgentSelector) return;
          await handleAgentSelectorSave(skillForAgentSelector, payload);
        }}
        agents={allAgents}
        loading={agentSelectorLoading}
        isGlobal={Boolean(
          skillForAgentSelector
          && skillForAgentSelector.id !== 'bulk'
          && globalSkillIdSet.has(canonicalSkillKeyFromSkill(skillForAgentSelector)),
        )}
        showGlobalControls={Boolean(skillForAgentSelector && skillForAgentSelector.id !== 'bulk')}
      />

      <ConfirmDialog
        open={!!confirmDialogState}
        title={confirmDialogState?.title ?? ''}
        message={confirmDialogState?.message ?? ''}
        confirmLabel={confirmDialogState?.confirmLabel}
        cancelLabel={confirmDialogState?.cancelLabel}
        variant={confirmDialogState?.variant}
        overlayClassName={SKILL_PICKER_MODAL_OVERLAY_CLASS}
        className={SKILL_PICKER_MODAL_CONTENT_CLASS}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </div>
  );
}

export default SkillsSettings;

/** Re-export: same sheet as {@link ServerMarketplaceSheet} with default source ClawHub. */
export { LegacyClawHubInstallSheet } from './LegacyClawHubInstallSheet';
