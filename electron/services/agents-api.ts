import type { GatewayManager } from '../gateway/manager';
import {
  awaitAgentRuntimeConvergence,
  noteConfigWatcherRefresh,
  type AgentRuntimeExpectation,
} from '../gateway/config-refresh-scheduler';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  listAgentsSnapshot,
  listAgentsSnapshotReadOnly,
  removeAgentWorkspaceDirectory,
  resolveAccountIdForAgent,
  setDefaultAgent,
  updateAgentId,
  updateAgentModel,
  updateAgentAutoSelect,
  updateAgentName,
  updateAgentSkills,
  updateDefaultModels,
} from '../utils/agent-config';
import { deleteChannelAccountConfig } from '../utils/channel-config';
import { setDefaultAgentSkills } from '../utils/global-agent-skills';
import { generateAgentText } from '../utils/agent-text-generation';
import { ensureClawXContext } from '../utils/openclaw-workspace';
import { isRecord } from './payload-utils';
import { syncAgentModelOverrideToRuntime, syncAllProviderAuthToRuntime } from './providers/provider-runtime-sync';
import { syncModelRouterPlugin } from './providers/model-router-sync';

type AgentsApiContext = {
  gatewayManager: GatewayManager;
};

function requireString(payload: unknown, key: string): string {
  if (!isRecord(payload) || typeof payload[key] !== 'string' || !payload[key].trim()) {
    throw new Error(`${key} is required`);
  }
  return payload[key].trim();
}

function scheduleGatewayReload(ctx: AgentsApiContext, reason: string): void {
  noteConfigWatcherRefresh(ctx.gatewayManager, `Agent config changed (${reason})`, {
    onlyIfRunning: true,
  });
}

function modelExpectations(
  snapshot: Awaited<ReturnType<typeof listAgentsSnapshotReadOnly>>,
  agentIds?: Set<string>,
): AgentRuntimeExpectation[] {
  return snapshot.agents.flatMap((agent) => {
    if (agentIds && !agentIds.has(agent.id)) return [];
    const modelRef = agent.modelRef?.trim();
    return modelRef ? [{ agentId: agent.id, modelRef }] : [];
  });
}

async function awaitSnapshotModels(
  ctx: AgentsApiContext,
  snapshot: Awaited<ReturnType<typeof listAgentsSnapshotReadOnly>>,
  options?: { agentIds?: Set<string>; expectedDefaultAgentId?: string },
): Promise<void> {
  await awaitAgentRuntimeConvergence(
    ctx.gatewayManager,
    modelExpectations(snapshot, options?.agentIds),
    { expectedDefaultAgentId: options?.expectedDefaultAgentId },
  );
}

async function restartGatewayForAgentDeletion(ctx: AgentsApiContext): Promise<void> {
  try {
    await ctx.gatewayManager.restart();
    console.log('[agents] Gateway restart completed after agent deletion');
  } catch (err) {
    console.warn('[agents] Gateway restart after agent deletion failed:', err);
  }
}

export function createAgentsApi(ctx: AgentsApiContext): CompleteHostServiceRegistry['agents'] {
  return {
    list: async (payload) => {
      const reconcile = !(isRecord(payload) && payload.reconcile === false);
      const snapshot = reconcile
        ? await listAgentsSnapshot()
        : await listAgentsSnapshotReadOnly();
      return { success: true, ...snapshot };
    },
    create: async (payload) => {
      const name = requireString(payload, 'name');
      const inheritWorkspace = isRecord(payload) ? payload.inheritWorkspace === true : undefined;
      const id = isRecord(payload) && typeof payload.id === 'string' ? payload.id : undefined;
      const skills = isRecord(payload) && Array.isArray(payload.skills)
        ? payload.skills.filter((skill): skill is string => typeof skill === 'string')
        : undefined;
      const snapshot = await createAgent(name, { id, inheritWorkspace, skills });
      syncAllProviderAuthToRuntime().catch((err) => {
        console.warn('[agents] Failed to sync provider auth after agent creation:', err);
      });
      scheduleGatewayReload(ctx, 'create-agent');
      void ensureClawXContext().catch((err) => {
        console.warn('[agents] Failed to ensure ClawX context after agent creation:', err);
      });
      return { success: true, ...snapshot };
    },
    update: async (payload) => {
      const agentId = requireString(payload, 'id');
      let snapshot = await listAgentsSnapshot();
      if (isRecord(payload) && typeof payload.name === 'string' && payload.name.trim()) {
        snapshot = await updateAgentName(agentId, payload.name.trim());
      }
      if (isRecord(payload) && Array.isArray(payload.skills)) {
        snapshot = await updateAgentSkills(
          agentId,
          payload.skills.filter((skill): skill is string => typeof skill === 'string'),
        );
      }
      scheduleGatewayReload(ctx, 'update-agent');
      return { success: true, ...snapshot };
    },
    updateId: async (payload) => {
      const agentId = requireString(payload, 'id');
      const newId = requireString(payload, 'newId');
      const snapshot = await updateAgentId(agentId, newId);
      try {
        const { remapOfficeAgentIdReferences } = await import('./office/store');
        await remapOfficeAgentIdReferences(agentId, newId);
      } catch (err) {
        console.warn('[agents] Failed to remap office agent id references:', err);
      }
      // An agent id rename migrates the agent workspace/identity; the running
      // Gateway must be fully replaced rather than hot-applied.
      await restartGatewayForAgentDeletion(ctx);
      return { success: true, ...snapshot };
    },
    updateModel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const modelRef = isRecord(payload) && typeof payload.modelRef === 'string' ? payload.modelRef : null;
      const targetSlot = isRecord(payload) && typeof payload.targetSlot === 'string'
        ? payload.targetSlot as Parameters<typeof updateAgentModel>[2]
        : undefined;
      const snapshot = await updateAgentModel(agentId, modelRef, targetSlot);
      try {
        await syncAllProviderAuthToRuntime();
        await syncAgentModelOverrideToRuntime(agentId);
      } catch (syncError) {
        console.warn('[agents] Failed to sync runtime after updating agent model:', syncError);
      }
      if ((targetSlot ?? 'model') === 'model') {
        await awaitSnapshotModels(ctx, snapshot, { agentIds: new Set([agentId]) });
      } else {
        scheduleGatewayReload(ctx, 'update-agent-model-slot');
      }
      return { success: true, ...snapshot };
    },
    updateDefaultModels: async (payload) => {
      const models = isRecord(payload) && isRecord(payload.models)
        ? Object.fromEntries(
          Object.entries(payload.models).filter(([, value]) => typeof value === 'string' || value === null),
        ) as Record<string, string | null>
        : {};
      const snapshot = await updateDefaultModels(models);
      try {
        await syncAllProviderAuthToRuntime();
        await syncAgentModelOverrideToRuntime('main');
      } catch (syncError) {
        console.warn('[agents] Failed to sync runtime after updating default models:', syncError);
      }
      if (Object.prototype.hasOwnProperty.call(models, 'model')) {
        await awaitSnapshotModels(ctx, snapshot);
      } else {
        scheduleGatewayReload(ctx, 'update-default-model-slots');
      }
      return { success: true, ...snapshot };
    },
    updateAutoSelect: async (payload) => {
      const agentId = requireString(payload, 'id');
      const autoSelectModel = isRecord(payload) && isRecord(payload.autoSelectModel)
        ? Object.fromEntries(
          Object.entries(payload.autoSelectModel).filter(([, v]) => typeof v === 'boolean'),
        ) as Parameters<typeof updateAgentAutoSelect>[1]['autoSelectModel']
        : undefined;
      const optimizationProfile = isRecord(payload) && typeof payload.optimizationProfile === 'string'
        ? payload.optimizationProfile as Parameters<typeof updateAgentAutoSelect>[1]['optimizationProfile']
        : undefined;
      const sensitiveMode = isRecord(payload) && typeof payload.sensitiveMode === 'boolean'
        ? payload.sensitiveMode
        : undefined;
      const snapshot = await updateAgentAutoSelect(agentId, { autoSelectModel, optimizationProfile, sensitiveMode });
      try {
        await syncModelRouterPlugin();
      } catch (syncError) {
        console.warn('[agents] Failed to sync model-router plugin:', syncError);
      }
      scheduleGatewayReload(ctx, 'update-agent-auto-select');
      return { success: true, ...snapshot };
    },
    setDefault: async (payload) => {
      const agentId = requireString(payload, 'id');
      const snapshot = await setDefaultAgent(agentId);
      await awaitSnapshotModels(ctx, snapshot, { expectedDefaultAgentId: agentId });
      return { success: true, ...snapshot };
    },
    delete: async (payload) => {
      const agentId = requireString(payload, 'id');
      const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
      await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
        console.warn('[agents] Failed to remove workspace after agent deletion:', err);
      });
      return { success: true, ...snapshot };
    },
    assignChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const snapshot = await assignChannelToAgent(agentId, channelType);
      return { success: true, ...snapshot };
    },
    removeChannel: async (payload) => {
      const agentId = requireString(payload, 'id');
      const channelType = requireString(payload, 'channelType');
      const ownerId = agentId.trim().toLowerCase();
      const snapshotBefore = await listAgentsSnapshot();
      const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
        .filter(([channelAccountKey, owner]) => {
          if (owner !== ownerId) return false;
          return channelAccountKey.startsWith(`${channelType}:`);
        })
        .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
      if (ownedAccountIds.length === 0) {
        const legacyAccountId = resolveAccountIdForAgent(agentId);
        if (snapshotBefore.channelAccountOwners[`${channelType}:${legacyAccountId}`] === ownerId) {
          ownedAccountIds.push(legacyAccountId);
        }
      }

      for (const accountId of ownedAccountIds) {
        await deleteChannelAccountConfig(channelType, accountId);
        await clearChannelBinding(channelType, accountId);
      }
      const snapshot = await listAgentsSnapshot();
      return { success: true, ...snapshot };
    },
    updateGlobalSkills: async (payload) => {
      const skills = isRecord(payload) && Array.isArray(payload.skills)
        ? payload.skills.filter((skill): skill is string => typeof skill === 'string')
        : [];
      const snapshot = await setDefaultAgentSkills(skills);
      scheduleGatewayReload(ctx, 'update-global-agent-skills');
      return { success: true, ...snapshot };
    },
    generateText: async (payload) => {
      const system = requireString(payload, 'system');
      const input = requireString(payload, 'input');
      const agentId = isRecord(payload) && typeof payload.agentId === 'string'
        ? payload.agentId.trim() : undefined;
      const temperature = isRecord(payload) && typeof payload.temperature === 'number'
        ? payload.temperature : undefined;
      const maxOutputTokens = isRecord(payload) && typeof payload.maxOutputTokens === 'number'
        ? payload.maxOutputTokens : undefined;
      const timeoutMs = isRecord(payload) && typeof payload.timeoutMs === 'number'
        ? payload.timeoutMs : undefined;
      try {
        const { text, modelRef } = await generateAgentText({
          agentId, system, input, temperature, maxOutputTokens, timeoutMs,
        });
        return { success: true, text, modelRef };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
