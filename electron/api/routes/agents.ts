// @ts-nocheck
import type { IncomingMessage, ServerResponse } from 'http';
import {
  assignChannelToAgent,
  clearChannelBinding,
  deleteAgentConfig,
  listAgentsSnapshot,
  listAgentsSnapshotReadOnly,
  removeAgentWorkspaceDirectory,
  resolveAccountIdForAgent,
  setDefaultAgent,
  updateAgentModel,
  updateDefaultModels,
  updateAgentName,
  updateAgentSkills,
  updateAgentId,
  slugifyAgentId,
} from '../../utils/agent-config';
import { getDefaultAgentSkills, setDefaultAgentSkills } from '../../utils/global-agent-skills';
import { deleteChannelAccountConfig } from '../../utils/channel-config';
import { createClientAgent } from '../../utils/agent-create-client';
import { syncAgentModelOverrideToRuntime, syncAllProviderAuthToRuntime } from '../../services/providers/provider-runtime-sync';
import type { HostApiContext } from '../context';
import { parseJsonBody, sendJson } from '../route-utils';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../../services/admin-console/notify-manager-config-snapshot';
import {
  awaitAgentRuntimeConvergence,
  noteConfigWatcherRefresh,
} from '../../gateway/config-refresh-scheduler';

function scheduleGatewayReload(ctx: HostApiContext, reason: string): void {
  noteConfigWatcherRefresh(ctx.gatewayManager, `Agent config changed (${reason})`, {
    onlyIfRunning: true,
  });
}

async function awaitSnapshotModels(
  ctx: HostApiContext,
  snapshot: Awaited<ReturnType<typeof listAgentsSnapshotReadOnly>>,
  options?: { agentIds?: Set<string>; expectedDefaultAgentId?: string },
): Promise<void> {
  const expectations = snapshot.agents.flatMap((agent) => {
    if (options?.agentIds && !options.agentIds.has(agent.id)) return [];
    const modelRef = agent.modelRef?.trim();
    return modelRef ? [{ agentId: agent.id, modelRef }] : [];
  });
  await awaitAgentRuntimeConvergence(ctx.gatewayManager, expectations, {
    expectedDefaultAgentId: options?.expectedDefaultAgentId,
  });
}

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

/**
 * Force a full Gateway process restart after agent deletion.
 *
 * A SIGUSR1 in-process reload is NOT sufficient here: channel plugins
 * (e.g. Feishu) maintain long-lived WebSocket connections to external
 * services and do not disconnect accounts that were removed from the
 * config during an in-process reload.  The only reliable way to drop
 * stale bot connections is to kill the Gateway process entirely and
 * spawn a fresh one that reads the updated openclaw.json from scratch.
 */
export async function restartGatewayForAgentDeletion(ctx: HostApiContext): Promise<void> {
  try {
    // Capture the PID of the running Gateway BEFORE stop() clears it.
    const status = ctx.gatewayManager.getStatus();
    const pid = status.pid;
    const port = status.port;
    console.log('[agents] Triggering Gateway restart (kill+respawn) after agent deletion', { pid, port });

    // Force-kill the Gateway process by PID.  The manager's stop() only
    // kills "owned" processes; if the manager connected to an already-
    // running Gateway (ownsProcess=false), stop() simply closes the WS
    // and the old process stays alive with its stale channel connections.
    if (pid) {
      try {
        if (process.platform === 'win32') {
          await execAsync(`taskkill /F /PID ${pid} /T`);
        } else {
          process.kill(pid, 'SIGTERM');
          // Give it a moment to die
          await new Promise((resolve) => setTimeout(resolve, 500));
          try { process.kill(pid, 0); process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
        }
      } catch {
        // process already gone – that's fine
      }
    } else if (port) {
      // If we don't know the PID (e.g. connected to an orphaned Gateway from
      // a previous pnpm dev run), forcefully kill whatever is on the port.
      try {
        if (process.platform === 'darwin' || process.platform === 'linux') {
          // MUST use -sTCP:LISTEN. Otherwise lsof returns the client process (ClawX itself) 
          // that has an ESTABLISHED WebSocket connection to the port, causing us to kill ourselves.
          const { stdout } = await execAsync(`lsof -t -i :${port} -sTCP:LISTEN`);
          const pids = stdout.trim().split('\n').filter(Boolean);
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGTERM'); } catch { /* ignore */ }
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
          for (const p of pids) {
            try { process.kill(parseInt(p, 10), 'SIGKILL'); } catch { /* ignore */ }
          }
        } else if (process.platform === 'win32') {
          // Find PID listening on the port
          const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
          const lines = stdout.trim().split('\n');
          const pids = new Set<string>();
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 5 && parts[1].endsWith(`:${port}`) && parts[3] === 'LISTENING') {
              pids.add(parts[4]);
            }
          }
          for (const p of pids) {
            try { await execAsync(`taskkill /F /PID ${p} /T`); } catch { /* ignore */ }
          }
        }
      } catch {
        // Port might not be bound or command failed; ignore
      }
    }

    await ctx.gatewayManager.restart();
    console.log('[agents] Gateway restart completed after agent deletion');
  } catch (err) {
    console.warn('[agents] Gateway restart after agent deletion failed:', err);
  }
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/agents' && req.method === 'GET') {
    const reconcile = url.searchParams.get('reconcile') !== 'false';
    const snapshot = reconcile
      ? await listAgentsSnapshot()
      : await listAgentsSnapshotReadOnly();
    sendJson(res, 200, { success: true, ...snapshot });
    return true;
  }

  if (url.pathname === '/api/agents/slugify' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string }>(req);
      const id = slugifyAgentId(body.name);
      sendJson(res, 200, { success: true, id });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ name: string; id?: string; inheritWorkspace?: boolean; skills?: string[] }>(req);
      const snapshot = await createClientAgent(body.name, {
        id: body.id,
        inheritWorkspace: body.inheritWorkspace,
        skills: body.skills,
      });
      notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_create');
      scheduleGatewayReload(ctx, 'create-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }


  if (url.pathname === '/api/agents/defaults/skills' && req.method === 'GET') {
    try {
      const skills = await getDefaultAgentSkills();
      sendJson(res, 200, { success: true, skills });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents/defaults/skills' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ skills: string[] }>(req);
      if (!Array.isArray(body.skills)) {
        throw new Error('skills array is required');
      }
      const snapshot = await setDefaultAgentSkills(body.skills);
      notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_update_default_skills');
      scheduleGatewayReload(ctx, 'update-default-skills');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname === '/api/agents/defaults/models' && req.method === 'PUT') {
    try {
      const body = await parseJsonBody<{ models: Record<string, string | null> }>(req);
      const snapshot = await updateDefaultModels(body.models);
      notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_update_default_models');
      try {
        await syncAllProviderAuthToRuntime();
        await syncAgentModelOverrideToRuntime('main');
      } catch (syncError) {
        console.warn('[agents] Failed to sync runtime after updating default models:', syncError);
      }
      if (Object.prototype.hasOwnProperty.call(body.models, 'model')) {
        await awaitSnapshotModels(ctx, snapshot);
      } else {
        scheduleGatewayReload(ctx, 'update-default-model-slots');
      }
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 500, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name?: string; skills?: string[] }>(req);
        const agentId = decodeURIComponent(parts[0]);
        if (typeof body.name !== 'string' && !Array.isArray(body.skills)) {
          throw new Error('At least one of name or skills is required');
        }
        let snapshot = await listAgentsSnapshot();
        if (typeof body.name === 'string') {
          snapshot = await updateAgentName(agentId, body.name);
        }
        if (Array.isArray(body.skills)) {
          snapshot = await updateAgentSkills(agentId, body.skills);
        }
        notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_update_name');
        scheduleGatewayReload(ctx, 'update-agent');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'id') {
      try {
        const body = await parseJsonBody<{ id: string }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentId(agentId, body.id);
        notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_update_id');
        await restartGatewayForAgentDeletion(ctx);
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'model') {
      try {
        const body = await parseJsonBody<{ modelRef?: string | null, targetSlot?: 'model' | 'imageModel' | 'imageGenerationModel' | 'videoGenerationModel' | 'musicGenerationModel' }>(req);
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await updateAgentModel(agentId, body.modelRef ?? null, body.targetSlot ?? 'model');
        notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_update_model');
        try {
          await syncAllProviderAuthToRuntime();
          // Ensure this agent's runtime model registry reflects the new model override.
          await syncAgentModelOverrideToRuntime(agentId);
        } catch (syncError) {
          console.warn('[agents] Failed to sync runtime after updating agent model:', syncError);
        }
        if ((body.targetSlot ?? 'model') === 'model') {
          await awaitSnapshotModels(ctx, snapshot, { agentIds: new Set([agentId]) });
        } else {
          scheduleGatewayReload(ctx, 'update-agent-model-slot');
        }
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 2 && parts[1] === 'default') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const snapshot = await setDefaultAgent(agentId);
        notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_set_default');
        await awaitSnapshotModels(ctx, snapshot, { expectedDefaultAgentId: agentId });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const snapshot = await assignChannelToAgent(agentId, channelType);
        scheduleGatewayReload(ctx, 'assign-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'DELETE') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const { snapshot, removedEntry } = await deleteAgentConfig(agentId);
        notifyManagerConfigSnapshotBeforeGatewayReload('local_agents_delete');
        // Await reload synchronously BEFORE responding to the client.
        // This ensures the Feishu plugin has disconnected the deleted bot
        // before the UI shows "delete success" and the user tries chatting.
        await restartGatewayForAgentDeletion(ctx);
        // Delete workspace after reload so the new config is already live.
        await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
          console.warn('[agents] Failed to remove workspace after agent deletion:', err);
        });
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }

    if (parts.length === 3 && parts[1] === 'channels') {
      try {
        const agentId = decodeURIComponent(parts[0]);
        const channelType = decodeURIComponent(parts[2]);
        const ownerId = agentId.trim().toLowerCase();
        const snapshotBefore = await listAgentsSnapshot();
        const ownedAccountIds = Object.entries(snapshotBefore.channelAccountOwners)
          .filter(([channelAccountKey, owner]) => {
            if (owner !== ownerId) return false;
            return channelAccountKey.startsWith(`${channelType}:`);
          })
          .map(([channelAccountKey]) => channelAccountKey.slice(channelAccountKey.indexOf(':') + 1));
        // Backward compatibility for legacy agentId->accountId mapping.
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
        scheduleGatewayReload(ctx, 'remove-agent-channel');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 500, { success: false, error: String(error) });
      }
      return true;
    }
  }

  return false;
}
