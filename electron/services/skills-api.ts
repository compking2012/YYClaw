import type { GatewayManager } from '../gateway/manager';
import type { ClawHubService, ClawHubInstallParams, ClawHubSearchParams, ClawHubUninstallParams } from '../gateway/clawhub';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { getAllSkillConfigs, getSkillConfig, updateSkillConfig, updateSkillConfigs } from '../utils/skill-config';
import {
  collectQuickAccessSkills,
  filterEnabledQuickAccessSkills,
  type QuickAccessRuntimeSkillStatus,
} from '../utils/skill-quick-access';
import { isRecord } from './payload-utils';
import {
  fetchRemoteSkillsMarketplace,
  prepareServerSkillInstall,
} from './skills-marketplace-client';
import { applyBatchSkillAgentsMapping, listEnhancedLocalSkills, purgeSkillFromAgentAllowlists } from '../utils/agent-config';
import { syncSkillsEntriesEnabledFromAgents } from '../utils/skill-entries-sync';
import { executeMarketplaceSkillUninstall } from './skills/skill-uninstall';
import {
  runManagedSameNameInstall,
  SAME_NAME_EXISTS_CODE,
} from './skills/skill-same-name-overwrite';
import { reconcileManagedSkillWinnersWhileLocked } from './skills/managed-skill-winner';
import {
  withGatewayHotSkillFilesystem,
  withGatewayRestartForSkillFilesystem,
  applySkillConfigHotWithFallback,
} from './skills/skill-gateway-fs-guard';
import {
  uploadSkillZipViaFarmWs,
  listPublishedMarketplaceSkills,
  listMarketplaceSkillReviewRequests,
  requestMarketplaceSkillUnlist,
  cancelMarketplaceSkillReviewRequest,
} from './skill-marketplace-upload-ws';
import { getSetting, setSetting } from '../utils/store';
import type { BrowserWindow } from 'electron';
import { showOpenDialogWithParent } from '../utils/dialog-parent';
import { existsSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import AdmZip from 'adm-zip';
import { machineIdSync } from 'node-machine-id';

type SkillConfigPayload = {
  skillKey?: unknown;
  enabled?: unknown;
  apiKey?: unknown;
  env?: unknown;
};

type SkillConfigsPayload = {
  updates?: unknown;
};

type NormalizedSkillConfigUpdate = {
  skillKey: string;
  enabled?: boolean;
  apiKey?: string;
  env?: Record<string, string>;
};

type QuickAccessPayload = {
  workspace?: unknown;
};

type SkillOpenPayload = {
  slug?: unknown;
  skillKey?: unknown;
  baseDir?: unknown;
};

type MarketplaceFetchPayload = {
  query?: unknown;
  limit?: unknown;
  category?: unknown;
};

type MarketplaceInstallPayload = {
  slug?: unknown;
  name?: unknown;
  version?: unknown;
  installedVersion?: unknown;
  archiveHash?: unknown;
  archive_hash?: unknown;
  listingRevision?: unknown;
  listing_revision?: unknown;
  versionBase?: unknown;
  version_base?: unknown;
  category?: unknown;
  baseDir?: unknown;
  workspace?: unknown;
  sessionAgentId?: unknown;
  overwriteSameName?: unknown;
};

type SkillAgentsMappingBatchPayload = {
  updates?: unknown;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getSkillUploadClientId(): Promise<string> {
  let id = await getSetting('machineId');
  if (!id) {
    id = machineIdSync();
    await setSetting('machineId', id);
  }
  return id;
}

/** Extract the `name` field from a SKILL.md YAML frontmatter (best-effort). */
function parseSkillNameFromMarkdown(md: string): string {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return '';
  const nameLine = fm[1].match(/^[ \t]*name[ \t]*:[ \t]*(.+)$/mi);
  if (!nameLine) return '';
  let value = nameLine[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

/** Find the shallowest SKILL.md in a zip (recursively) and return its text. */
function readSkillMdFromZip(zip: AdmZip): string {
  let bestDepth = -1;
  let bestContent = '';
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    if (name.startsWith('__MACOSX/')) continue;
    const base = name.split('/').pop() || '';
    if (base.toLowerCase() !== 'skill.md') continue;
    const depth = (name.match(/\//g) || []).length;
    if (bestDepth === -1 || depth < bestDepth) {
      bestDepth = depth;
      bestContent = entry.getData().toString('utf8');
    }
  }
  return bestContent;
}

function skillVersionBaseFromId(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  const match = normalized.match(/^(.+)-\d+_\d+_\d+$/);
  return match ? match[1] : normalized;
}

function publishedSkillBase(skill: {
  skill_id: string;
  version_base?: string;
  display_name?: string;
}): string {
  return skill.version_base?.trim().toLowerCase()
    || skillVersionBaseFromId(skill.skill_id)
    || skill.display_name?.trim().toLowerCase()
    || skill.skill_id.trim().toLowerCase();
}

function compareSemver(a?: string, b?: string): number {
  const parse = (value?: string): [number, number, number] | null => {
    const m = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function getSkillKey(payload: unknown): string {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  if (typeof body.skillKey !== 'string' || !body.skillKey.trim()) {
    throw new Error('skillKey is required');
  }
  return body.skillKey.trim();
}

function getEnv(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function getConfigUpdate(payload: unknown): NormalizedSkillConfigUpdate {
  const body = isRecord(payload) ? payload as SkillConfigPayload : {};
  return {
    skillKey: getSkillKey(payload),
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    env: getEnv(body.env),
  };
}

function getConfigUpdates(payload: unknown): NormalizedSkillConfigUpdate[] {
  const body = isRecord(payload) ? payload as SkillConfigsPayload : {};
  if (!Array.isArray(body.updates)) return [];
  return body.updates.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const skillKey = typeof entry.skillKey === 'string' ? entry.skillKey.trim() : '';
    if (!skillKey) return [];
    return [{
      skillKey,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
      apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
      env: getEnv(entry.env),
    }];
  });
}

export function createSkillsApi({
  clawHubService,
  gatewayManager,
  mainWindow,
}: {
  clawHubService: ClawHubService;
  gatewayManager: GatewayManager;
  mainWindow: BrowserWindow;
}): CompleteHostServiceRegistry['skills'] {
  return {
    /** Same aggregation as GET /api/skills/local (agents + enabled from agents.list). */
    local: async () => ({ success: true, skills: await listEnhancedLocalSkills() }),
    configs: async () => getAllSkillConfigs(),
    allConfigs: async () => getAllSkillConfigs(),
    getConfig: async (payload) => {
      const config = await getSkillConfig(getSkillKey(payload));
      return config ? { ...config } : undefined;
    },
    updateConfig: async (payload) => {
      const { skillKey, ...updates } = getConfigUpdate(payload);
      const result = await updateSkillConfig(skillKey, updates);
      // skills config is hot-appliable (kernel bumps the skills snapshot version
      // so sessions rebuild on next turn); push it via config.apply so the change
      // takes effect without waiting for the (unreliable) kernel config file
      // watcher. Never restarts the Gateway.
      await applySkillConfigHotWithFallback(gatewayManager);
      return result;
    },
    updateConfigs: async (payload) => {
      const result = await updateSkillConfigs(getConfigUpdates(payload));
      await applySkillConfigHotWithFallback(gatewayManager);
      return result;
    },
    status: async () => gatewayManager.rpc('skills.status'),
    update: async (payload) => gatewayManager.rpc('skills.update', isRecord(payload) ? payload : {}),
    quickAccess: async (payload) => {
      const body = isRecord(payload) ? payload as QuickAccessPayload : {};
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: typeof body.workspace === 'string' ? body.workspace : undefined,
        }),
        getAllSkillConfigs(),
      ]);
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (gatewayManager.getStatus().state === 'running') {
        try {
          const runtimeStatus = await gatewayManager.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      }
      return {
        success: true,
        skills: filterEnabledQuickAccessSkills(scannedSkills, runtimeSkills, configs),
      };
    },
    clawhubCapability: async () => {
      try {
        return { success: true, capability: await clawHubService.getMarketplaceCapability() };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubList: async () => {
      try {
        return { success: true, results: await clawHubService.listInstalled() };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubSearch: async (payload) => {
      try {
        return { success: true, results: await clawHubService.search((isRecord(payload) ? payload : {}) as ClawHubSearchParams) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubInstall: async (payload) => {
      try {
        const body = (isRecord(payload) ? payload : {}) as ClawHubInstallParams & { overwriteSameName?: boolean };
        const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
        const result = await runManagedSameNameInstall({
          skillName: slug,
          overwriteSameName: !!body.overwriteSameName,
          withFilesystemGuard: async (operation) => (
            withGatewayHotSkillFilesystem(gatewayManager, operation)
          ),
          install: async () => clawHubService.install(body),
          afterCommit: async () => {
            await reconcileManagedSkillWinnersWhileLocked();
          },
        });
        if (!result.ok) {
          return {
            success: false,
            error: SAME_NAME_EXISTS_CODE,
            code: result.code,
            displayName: result.displayName,
            existingIds: result.existingIds,
          };
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubUninstall: async (payload) => {
      try {
        const body = (isRecord(payload) ? payload : {}) as ClawHubUninstallParams;
        const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
        if (slug) {
          await purgeSkillFromAgentAllowlists(slug);
        }
        await withGatewayRestartForSkillFilesystem(gatewayManager, async () => {
          await clawHubService.uninstall(body);
        });
        await syncSkillsEntriesEnabledFromAgents();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillReadme: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillReadme(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    clawhubOpenSkillPath: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as SkillOpenPayload : {};
        const skillKey = typeof body.skillKey === 'string' ? body.skillKey : '';
        const slug = typeof body.slug === 'string' ? body.slug : undefined;
        const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
        await clawHubService.openSkillPath(skillKey || slug || '', slug, baseDir);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    marketplaceList: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as MarketplaceFetchPayload : {};
        const query = typeof body.query === 'string' ? body.query : '';
        const limit = typeof body.limit === 'number' ? body.limit : 50;
        const category = typeof body.category === 'string' ? body.category : undefined;
        return { success: true, results: await fetchRemoteSkillsMarketplace({ query, limit, category }) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    marketplaceSearch: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as MarketplaceFetchPayload : {};
        const query = typeof body.query === 'string' ? body.query : '';
        const limit = typeof body.limit === 'number' ? body.limit : 50;
        const category = typeof body.category === 'string' ? body.category : undefined;
        return { success: true, results: await fetchRemoteSkillsMarketplace({ query, limit, category }) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    marketplaceInstall: async (payload) => {
      try {
        const body = (isRecord(payload) ? payload : {}) as MarketplaceInstallPayload & {
          overwriteSameName?: boolean;
        };
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
        const overwriteSameName = !!body.overwriteSameName;
        const conflictName = name || slug;
        const archiveHash = typeof body.archive_hash === 'string'
          ? body.archive_hash.trim()
          : typeof body.archiveHash === 'string'
            ? body.archiveHash.trim()
            : undefined;
        const listingRevision = typeof body.listing_revision === 'string'
          ? body.listing_revision.trim()
          : typeof body.listingRevision === 'string'
            ? body.listingRevision.trim()
            : undefined;
        const installedVersion = typeof body.version === 'string'
          ? body.version.trim()
          : typeof body.installedVersion === 'string'
            ? body.installedVersion.trim()
            : undefined;
        const versionBase = typeof body.version_base === 'string'
          ? body.version_base.trim()
          : typeof body.versionBase === 'string'
            ? body.versionBase.trim()
            : undefined;
        const category = typeof body.category === 'string' ? body.category.trim() : undefined;
        const serverArtifact = name
          ? await prepareServerSkillInstall(
            name,
            archiveHash,
            listingRevision,
            installedVersion,
            versionBase,
            category,
          )
          : null;
        const result = await runManagedSameNameInstall({
          skillName: serverArtifact?.identity.canonicalName || conflictName,
          skillAliases: [
            ...(serverArtifact?.identity.aliases || []),
            ...(versionBase ? [versionBase] : []),
            ...(name ? [name] : []),
          ],
          overwriteSameName,
          withFilesystemGuard: async (operation) => (
            withGatewayHotSkillFilesystem(gatewayManager, operation)
          ),
          install: async () => {
            if (serverArtifact) {
              await serverArtifact.install();
              return;
            }
            await clawHubService.install(
              (isRecord(payload) ? payload : {}) as ClawHubInstallParams,
            );
          },
          afterCommit: async () => {
            await reconcileManagedSkillWinnersWhileLocked();
          },
        });
        if (!result.ok) {
          return {
            success: false,
            error: SAME_NAME_EXISTS_CODE,
            code: result.code,
            displayName: result.displayName,
            existingIds: result.existingIds,
          };
        }
        await syncSkillsEntriesEnabledFromAgents();
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    marketplaceUninstall: async (payload) => {
      const body = isRecord(payload) ? payload as MarketplaceInstallPayload : {};
      const result = await executeMarketplaceSkillUninstall(
        {
          slug: typeof body.slug === 'string' ? body.slug : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
          baseDir: typeof body.baseDir === 'string' ? body.baseDir : undefined,
        },
        { gatewayManager, clawHubService },
      );
      return result.success ? { success: true } : { success: false, error: result.error };
    },
    updateAgentsMappingBatch: async (payload) => {
      try {
        const body = isRecord(payload) ? payload as SkillAgentsMappingBatchPayload : {};
        const updates = Array.isArray(body.updates)
          ? body.updates.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const skillId = typeof entry.skillId === 'string' ? entry.skillId : '';
            const agentIds = Array.isArray(entry.agentIds)
              ? entry.agentIds.filter((agentId): agentId is string => typeof agentId === 'string')
              : [];
            return skillId ? [{ skillId, agentIds }] : [];
          })
          : [];
        await applyBatchSkillAgentsMapping(updates);
        return { success: true };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    // Skill custom UI (DynamicRenderer): no backend implementation in this build,
    // preserved as typed no-ops so consumers route through the host API facade.
    getUiSchema: async () => null,
    executeUiAction: async () => ({ success: false, error: 'SKILL_UI_ACTION_UNSUPPORTED' }),
    listPublishedMarketplace: async () => {
      try {
        const clientId = await getSkillUploadClientId();
        const skills = await listPublishedMarketplaceSkills(clientId);
        return { success: true, skills };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    getPublishMeta: async (payload) => {
      try {
        const body: Record<string, unknown> = isRecord(payload) ? payload : {};
        const filePath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
        let username = '';
        try {
          username = (userInfo().username || '').trim();
        } catch {
          username = '';
        }
        let skillName = '';
        if (filePath && existsSync(filePath)) {
          try {
            const zip = new AdmZip(readFileSync(filePath));
            skillName = parseSkillNameFromMarkdown(readSkillMdFromZip(zip));
          } catch {
            skillName = '';
          }
        }
        let remoteVersion = '';
        if (skillName) {
          const base = skillVersionBaseFromId(skillName);
          const considerVersion = (version?: string) => {
            const trimmed = (version || '').trim();
            if (trimmed && (!remoteVersion || compareSemver(trimmed, remoteVersion) > 0)) {
              remoteVersion = trimmed;
            }
          };
          // Query the whole marketplace so skills published by other clients are
          // detected too (my-published only covers the current client's uploads).
          try {
            const listings = await fetchRemoteSkillsMarketplace({ query: skillName, limit: 50 });
            for (const listing of listings) {
              const listingBase = listing.versionBase?.trim().toLowerCase()
                || skillVersionBaseFromId(listing.slug)
                || listing.name.trim().toLowerCase();
              if (listingBase === base) considerVersion(listing.version);
            }
          } catch {
            // Ignore marketplace search failures; fall back to my-published below.
          }
          // Fall back to the current client's published skills (covers edge cases
          // where the search index lags or the listing is not yet public).
          try {
            const clientId = await getSkillUploadClientId();
            const published = await listPublishedMarketplaceSkills(clientId);
            for (const skill of published) {
              if (publishedSkillBase(skill) === base) considerVersion(skill.version);
            }
          } catch {
            // Ignore my-published failures.
          }
        }
        return {
          success: true,
          meta: { username, skillName, remoteVersion: remoteVersion || undefined },
        };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    uploadMarketplaceZip: async (payload) => {
      try {
        const body = isRecord(payload) ? payload : {};
        const confirmUnsafe = !!body.confirmUnsafe;
        const overwriteSameName = !!body.overwriteSameName;
        const author = typeof body.author === 'string' ? body.author.trim() : '';
        const version = typeof body.version === 'string' ? body.version.trim() : '';
        const category = typeof body.category === 'string' ? body.category.trim() : '';
        let zipPath = typeof body.filePath === 'string' ? body.filePath.trim() : '';
        if (!zipPath) {
          const picked = await showOpenDialogWithParent(mainWindow, {
            title: 'Skill zip',
            properties: ['openFile'],
            filters: [{ name: 'ZIP', extensions: ['zip'] }],
          });
          if (picked.canceled || !picked.filePaths[0]) {
            return { success: true, cancelled: true };
          }
          zipPath = picked.filePaths[0];
        }
        if (!existsSync(zipPath)) {
          return { success: false, error: 'SKILL_UPLOAD_WS_FILE_NOT_FOUND' };
        }
        const clientId = await getSkillUploadClientId();
        const result = await uploadSkillZipViaFarmWs({
          zipFilePath: zipPath,
          clientId,
          confirmUnsafe,
          overwriteSameName,
          author,
          version,
          category,
        });
        return { success: true, result, pickedPath: zipPath };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    listMarketplaceReviewRequests: async () => {
      try {
        const clientId = await getSkillUploadClientId();
        const requests = await listMarketplaceSkillReviewRequests(clientId, 100);
        return { success: true, requests };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    requestMarketplaceUnlist: async (payload) => {
      try {
        const body: { skillId?: unknown } = isRecord(payload) ? payload : {};
        const skillId = typeof body.skillId === 'string' ? body.skillId.trim() : '';
        if (!skillId) {
          return { success: false, error: 'SKILL_ID_REQUIRED' };
        }
        const clientId = await getSkillUploadClientId();
        const result = await requestMarketplaceSkillUnlist(clientId, skillId);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
    cancelMarketplaceReviewRequest: async (payload) => {
      try {
        const body: { requestId?: unknown } = isRecord(payload) ? payload : {};
        const requestId =
          typeof body.requestId === 'number'
            ? body.requestId
            : Number.parseInt(String(body.requestId ?? ''), 10);
        if (!Number.isFinite(requestId) || requestId <= 0) {
          return { success: false, error: 'REQUEST_ID_REQUIRED' };
        }
        const clientId = await getSkillUploadClientId();
        const result = await cancelMarketplaceSkillReviewRequest(clientId, requestId);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    },
  };
}
