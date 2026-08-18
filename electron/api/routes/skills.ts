// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- OpenClaw config shapes are loosely typed in host routes
// @ts-nocheck
import type { IncomingMessage, ServerResponse } from 'http';
import { basename } from 'path';
import {
  fetchRemoteSkillsMarketplace,
  prepareServerSkillInstall,
} from '../../services/skills-marketplace-client';
import { getAllSkillConfigs, updateSkillConfig, updateSkillConfigs } from '../../utils/skill-config';
import {
  collectQuickAccessSkills,
  filterEnabledQuickAccessSkills,
  type QuickAccessRuntimeSkillStatus,
} from '../../utils/skill-quick-access';
import { listLocalSkills } from '../../services/skills/local-skill-service';
import { listAgentsSnapshot, applySkillAgentsMapping, applyBatchSkillAgentsMapping, listEnhancedLocalSkills } from '../../utils/agent-config';
import { syncSkillsEntriesEnabledFromAgents } from '../../utils/skill-entries-sync';
import { runPostInstallWorkspaceAgentSkillSyncFromPayload } from '../../utils/workspace-agent-skills-sync';
import { executeMarketplaceSkillUninstall } from '../../services/skills/skill-uninstall';
import {
  normalizeSkillKey,
  canonicalSkillKeyFromRecord,
} from '../../utils/skill-agent-mapping';
import { reconcileManagedSkillWinnersWhileLocked } from '../../services/skills/managed-skill-winner';
import { withGatewayHotSkillFilesystem, applySkillConfigHotWithFallback } from '../../services/skills/skill-gateway-fs-guard';
import type { MarketplaceInstallParams, MarketplaceSearchParams, MarketplaceUninstallParams } from '../../gateway/clawhub';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';

function normalizeSkillPath(value?: string): string {
  return (value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

async function handleMarketplaceCapability(res: ServerResponse, ctx: HostApiContext): Promise<void> {
  sendJson(res, 200, {
    success: true,
    capability: await ctx.clawHubService.getMarketplaceCapability(),
  });
}

async function handleMarketplaceSearch(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceSearchParams>(req);
  sendJson(res, 200, {
    success: true,
    results: await ctx.clawHubService.search(body),
  });
}

async function handleMarketplaceInstall(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceInstallParams & { overwriteSameName?: boolean }>(req);
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const { runManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
    '../../services/skills/skill-same-name-overwrite'
  );
  const result = await runManagedSameNameInstall({
    skillName: slug,
    overwriteSameName: !!body.overwriteSameName,
    withFilesystemGuard: async (operation) => (
      withGatewayHotSkillFilesystem(ctx.gatewayManager, operation)
    ),
    install: async () => ctx.clawHubService.install(body),
    afterCommit: async () => {
      await reconcileManagedSkillWinnersWhileLocked();
    },
  });
  if (!result.ok) {
    sendJson(res, 200, {
      success: false,
      error: SAME_NAME_EXISTS_CODE,
      code: result.code,
      displayName: result.displayName,
      existingIds: result.existingIds,
    });
    return;
  }
  await syncSkillsEntriesEnabledFromAgents();
  // Post-install workspace/.agents sync is a no-op (scan policy P5–P7).
  await runPostInstallWorkspaceAgentSkillSyncFromPayload(body);
  sendJson(res, 200, { success: true });
}

async function handleMarketplaceUninstall(req: IncomingMessage, res: ServerResponse, ctx: HostApiContext): Promise<void> {
  const body = await parseJsonBody<MarketplaceUninstallParams>(req);
  const result = await executeMarketplaceSkillUninstall(body, {
    gatewayManager: ctx.gatewayManager,
    clawHubService: ctx.clawHubService,
  });
  if (!result.success) {
    sendJson(res, 500, { success: false, error: result.error });
    return;
  }
  sendJson(res, 200, { success: true });
}

async function handleMarketplaceList(res: ServerResponse, ctx: HostApiContext): Promise<void> {
  sendJson(res, 200, { success: true, results: await ctx.clawHubService.listInstalled() });
}

export async function handleSkillRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/skills/configs' && req.method === 'GET') {
    sendJson(res, 200, await getAllSkillConfigs());
    return true;
  }

  if (url.pathname === '/api/skills/config' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{
        skillKey: string;
        enabled?: boolean;
        apiKey?: string;
        env?: Record<string, string>;
      }>(req);
      const result = await updateSkillConfig(body.skillKey, {
        enabled: body.enabled,
        apiKey: body.apiKey,
        env: body.env,
      });
      await applySkillConfigHotWithFallback(ctx.gatewayManager);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/configs' && req.method === 'PATCH') {
    try {
      const body = await parseJsonBody<{
        updates?: Array<{
          skillKey: string;
          enabled?: boolean;
          apiKey?: string;
          env?: Record<string, string>;
        }>;
      }>(req);
      const result = await updateSkillConfigs(body.updates || []);
      await applySkillConfigHotWithFallback(ctx.gatewayManager);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/local' && req.method === 'GET') {
    try {
      const enhancedSkills = await listEnhancedLocalSkills();
      sendJson(res, 200, {
        success: true,
        skills: enhancedSkills,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/agents-mapping' && req.method === 'GET') {
    try {
      const enhancedSkills = await listEnhancedLocalSkills();
      const mapping: Record<string, string[]> = {};
      for (const skill of enhancedSkills) {
        const canonicalId = canonicalSkillKeyFromRecord(skill);
        mapping[canonicalId] = skill.agents;
      }
      sendJson(res, 200, {
        success: true,
        mapping,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/agents-mapping/batch' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        updates?: Array<{ skillId: string; agentIds: string[] }>;
      }>(req);
      await applyBatchSkillAgentsMapping(body.updates || []);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/agents-mapping' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        skillId: string;
        agentIds: string[];
      }>(req);
      await applySkillAgentsMapping(body.skillId, body.agentIds || []);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/quick-access' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        workspace?: string;
        agentId?: string;
      }>(req);
      const [scannedSkills, configs] = await Promise.all([
        collectQuickAccessSkills({
          workspace: body.workspace,
        }),
        getAllSkillConfigs(),
      ]);
      const normalizedAgentId = (body.agentId || '').trim().toLowerCase();
      let allowlist: Set<string> | null = null;
      if (normalizedAgentId) {
        const snapshot = await listAgentsSnapshot();
        const agent = snapshot.agents.find((entry) => entry.id.trim().toLowerCase() === normalizedAgentId);
        allowlist = new Set((agent?.skills || []).map((skillKey) => normalizeSkillKey(skillKey)));
      }
      let runtimeSkills: QuickAccessRuntimeSkillStatus[] | undefined;
      if (ctx.gatewayManager.getStatus().state === 'running') {
        try {
          const runtimeStatus = await ctx.gatewayManager.rpc<{ skills?: QuickAccessRuntimeSkillStatus[] }>('skills.status');
          runtimeSkills = runtimeStatus.skills || [];
        } catch {
          runtimeSkills = undefined;
        }
      }
      const enabledSkills = filterEnabledQuickAccessSkills(scannedSkills, runtimeSkills, configs);
      let skills = enabledSkills;
      if (allowlist) {
        const localSkills = await listLocalSkills();
        const skillIdByBaseDir = new Map<string, string>();
        for (const localSkill of localSkills) {
          const normalizedPath = normalizeSkillPath(localSkill.baseDir);
          if (!normalizedPath) continue;
          skillIdByBaseDir.set(normalizedPath, normalizeSkillKey(canonicalSkillKeyFromRecord(localSkill)));
        }
        skills = enabledSkills.filter((skill) => {
          const byPath = skillIdByBaseDir.get(normalizeSkillPath(skill.baseDir));
          const aliases = [
            normalizeSkillKey(skill.name),
            normalizeSkillKey(skill.baseDir ? basename(skill.baseDir) : ''),
            byPath || '',
          ];
          return aliases.some((alias) => alias && allowlist!.has(alias));
        });
      }
      sendJson(res, 200, {
        success: true,
        skills,
      });
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace' && req.method === 'GET') {
    try {
      const query = url.searchParams.get('query') ?? '';
      const limitRaw = url.searchParams.get('limit');
      const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : 50;
      const limit = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 50;
      const results = await fetchRemoteSkillsMarketplace({ query, limit });
      sendJson(res, 200, { success: true, results });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/capability' && req.method === 'GET') {
    try {
      await handleMarketplaceCapability(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/search' && req.method === 'POST') {
    try {
      await handleMarketplaceSearch(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{
        name?: string;
        archive_hash?: string;
        archiveHash?: string;
        listing_revision?: string;
        listingRevision?: string;
        version?: string;
        installedVersion?: string;
        version_base?: string;
        versionBase?: string;
        overwriteSameName?: boolean;
      } & MarketplaceInstallParams>(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
      const conflictName = name || slug;
      const { runManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
        '../../services/skills/skill-same-name-overwrite'
      );
      if (name) {
        // Farm/server marketplace install: skill ZIP fetched from the YYClaw server by `name`.
        const archiveHash =
          typeof body.archive_hash === 'string'
            ? body.archive_hash.trim()
            : typeof body.archiveHash === 'string'
              ? body.archiveHash.trim()
              : undefined;
        const listingRevision =
          typeof body.listing_revision === 'string'
            ? body.listing_revision.trim()
            : typeof body.listingRevision === 'string'
              ? body.listingRevision.trim()
              : undefined;
        const installedVersion =
          typeof body.version === 'string'
            ? body.version.trim()
            : typeof body.installedVersion === 'string'
              ? body.installedVersion.trim()
              : undefined;
        const versionBase =
          typeof body.version_base === 'string'
            ? body.version_base.trim()
            : typeof body.versionBase === 'string'
              ? body.versionBase.trim()
              : undefined;
        const serverArtifact = await prepareServerSkillInstall(
          name,
          archiveHash,
          listingRevision,
          installedVersion,
          versionBase,
        );
        const result = await runManagedSameNameInstall({
          skillName: serverArtifact.identity.canonicalName,
          skillAliases: [
            ...serverArtifact.identity.aliases,
            ...(versionBase ? [versionBase] : []),
            name,
          ],
          overwriteSameName: !!body.overwriteSameName,
          withFilesystemGuard: async (operation) => (
            withGatewayHotSkillFilesystem(ctx.gatewayManager, operation)
          ),
          install: serverArtifact.install,
          afterCommit: async () => {
            await reconcileManagedSkillWinnersWhileLocked();
          },
        });
        if (!result.ok) {
          sendJson(res, 200, {
            success: false,
            error: SAME_NAME_EXISTS_CODE,
            code: result.code,
            displayName: result.displayName,
            existingIds: result.existingIds,
          });
          return true;
        }
        await syncSkillsEntriesEnabledFromAgents();
        sendJson(res, 200, { success: true });
      } else {
        // ClawHub marketplace install: delegates to the registered marketplace provider by `slug`.
        const result = await runManagedSameNameInstall({
          skillName: conflictName,
          overwriteSameName: !!body.overwriteSameName,
          withFilesystemGuard: async (operation) => (
            withGatewayHotSkillFilesystem(ctx.gatewayManager, operation)
          ),
          install: async () => ctx.clawHubService.install(body),
          afterCommit: async () => {
            await reconcileManagedSkillWinnersWhileLocked();
          },
        });
        if (!result.ok) {
          sendJson(res, 200, {
            success: false,
            error: SAME_NAME_EXISTS_CODE,
            code: result.code,
            displayName: result.displayName,
            existingIds: result.existingIds,
          });
          return true;
        }
        await syncSkillsEntriesEnabledFromAgents();
        sendJson(res, 200, { success: true });
      }
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/uninstall' && req.method === 'POST') {
    try {
      await handleMarketplaceUninstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/skills/marketplace/list' && req.method === 'GET') {
    try {
      await handleMarketplaceList(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/capability' && req.method === 'GET') {
    try {
      await handleMarketplaceCapability(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/search' && req.method === 'POST') {
    try {
      await handleMarketplaceSearch(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/install' && req.method === 'POST') {
    try {
      await handleMarketplaceInstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/uninstall' && req.method === 'POST') {
    try {
      await handleMarketplaceUninstall(req, res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/list' && req.method === 'GET') {
    try {
      await handleMarketplaceList(res, ctx);
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-readme' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillReadme(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/clawhub/open-path' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ slug?: string; skillKey?: string; baseDir?: string }>(req);
      await ctx.clawHubService.openSkillPath(body.skillKey || body.slug || '', body.slug, body.baseDir);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  return false;
}
